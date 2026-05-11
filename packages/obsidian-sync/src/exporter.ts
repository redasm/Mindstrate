/**
 * VaultExporter: writes Mindstrate knowledge units into the Obsidian vault as markdown files.
 *
 * Strategy:
 *  - Full export: iterate all KUs, write each to its layout-determined path, refresh index.
 *  - Incremental export (after add/update/delete): write/move/remove a single file.
 *
 * Conflict-friendly design:
 *  - User-edited content below the END_MARKER is preserved on overwrite.
 *  - We only touch the file when Mindstrate's body actually differs from what's on disk
 *    (compared via bodyHash), to avoid unnecessary file writes that would trigger
 *    the watcher and create a sync ping-pong.
 *
 * What VaultExporter does NOT export:
 *  - Architecture system-page RULE nodes (tag `system-page`). They are
 *    already written under the same `<vault>/<project>/architecture/`
 *    directory by `writeProjectGraphObsidianProjection` using human
 *    friendly filenames (`00-overview.md` ... `07-risky-files.md`); if
 *    the exporter also emitted them via the generic `<title>--<idHash>.md`
 *    pattern, every architecture page would appear twice in the vault.
 */

import * as fs from 'node:fs';
import {
  type GraphKnowledgeView,
  type Mindstrate,
} from '@mindstrate/server';
import {
  serializeGraphKnowledge,
  parseMarkdown,
  computeBodyHash,
} from './markdown.js';
import { errorMessage, readTextIfExists } from './file-io.js';
import { VaultLayout, type VaultIndex } from './vault-layout.js';

/**
 * Architecture system-page RULE nodes carry this tag. They have an
 * authoritative on-disk representation written by the server's
 * `writeProjectGraphObsidianProjection` and must be skipped by the
 * generic graph-knowledge exporter to avoid duplicate
 * `<title>--<idHash>.md` files in the same architecture folder.
 */
export const SYSTEM_PAGE_TAG = 'system-page';

export const isExportableGraphView = (view: GraphKnowledgeView): boolean =>
  !view.tags.includes(SYSTEM_PAGE_TAG);

export interface ExportResult {
  written: number;
  skipped: number;
  removed: number;
  moved: number;
  errors: Array<{ id: string; error: string }>;
}

export interface VaultExporterOptions {
  layout: VaultLayout;
  /** Quiet logs */
  silent?: boolean;
  /** Markdown language for generated labels. Defaults to MINDSTRATE_LOCALE or English. */
  locale?: string;
}

export class VaultExporter {
  private layout: VaultLayout;
  private silent: boolean;
  private locale?: string;

  constructor(opts: VaultExporterOptions) {
    this.layout = opts.layout;
    this.silent = opts.silent ?? false;
    this.locale = opts.locale ?? process.env.MINDSTRATE_LOCALE;
  }

  /**
   * Export the entire Mindstrate database into the vault.
   * Removes vault files whose ids are no longer present in Mindstrate
   * (only inside our managed folders).
   */
  async exportAll(memory: Mindstrate): Promise<ExportResult> {
    this.layout.ensureRoot();
    const result: ExportResult = { written: 0, skipped: 0, removed: 0, moved: 0, errors: [] };

    const all = memory.context.readGraphKnowledge({ limit: 100000 });
    const idx: VaultIndex = this.layout.loadIndex();
    const newIndex: VaultIndex = {
      files: {},
      projectGraphPages: idx.projectGraphPages,
      version: idx.version,
      lastFullSyncAt: new Date().toISOString(),
    };

    const desiredAbsPaths = new Set<string>();

    for (const k of all) {
      if (!isExportableGraphView(k)) continue;
      try {
        const rel = this.layout.relativePathForGraphView(k);
        const oldRel = idx.files[k.id];
        const writeRes = this.writeGraphView(k, rel, oldRel);
        if (writeRes === 'written') result.written++;
        else if (writeRes === 'moved') { result.moved++; result.written++; }
        else result.skipped++;
        newIndex.files[k.id] = rel;
        desiredAbsPaths.add(this.layout.absolutePath(rel));
      } catch (err) {
        result.errors.push({ id: k.id, error: errorMessage(err) });
      }
    }

    // Remove orphan files that were once managed by us but no longer correspond to a KU.
    for (const [oldId, oldRel] of Object.entries(idx.files)) {
      if (!newIndex.files[oldId]) {
        try {
          const abs = this.layout.absolutePath(oldRel);
          if (fs.existsSync(abs)) {
            // Only delete if file still looks like one of ours (has frontmatter id matching)
            const text = readTextIfExists(abs);
            const parsed = text ? parseMarkdown(text) : null;
            if (parsed && parsed.frontmatter.id === oldId) {
              fs.unlinkSync(abs);
              result.removed++;
            }
          }
        } catch (err) {
          result.errors.push({ id: oldId, error: 'remove orphan: ' + errorMessage(err) });
        }
      }
    }

    this.layout.saveIndex(newIndex);
    if (!this.silent) {
      console.error(
        `[obsidian-sync] export: written=${result.written}, skipped=${result.skipped}, ` +
        `moved=${result.moved}, removed=${result.removed}, errors=${result.errors.length}`,
      );
    }
    return result;
  }

  exportGraphView(k: GraphKnowledgeView): 'written' | 'skipped' | 'moved' {
    if (!isExportableGraphView(k)) return 'skipped';
    this.layout.ensureRoot();
    const idx = this.layout.loadIndex();
    const rel = this.layout.relativePathForGraphView(k);
    const oldRel = idx.files[k.id];
    const res = this.writeGraphView(k, rel, oldRel);
    idx.files[k.id] = rel;
    this.layout.saveIndex(idx);
    return res;
  }

  /** Remove a knowledge unit's file from the vault (incremental delete). */
  removeOne(id: string): boolean {
    const idx = this.layout.loadIndex();
    const rel = idx.files[id];
    if (!rel) return false;
    const abs = this.layout.absolutePath(rel);
    let removed = false;
    if (fs.existsSync(abs)) {
      try {
        // Verify file is still ours before deleting
        const text = readTextIfExists(abs);
        const parsed = text ? parseMarkdown(text) : null;
        if (parsed && parsed.frontmatter.id === id) {
          fs.unlinkSync(abs);
          removed = true;
        }
      } catch {
        /* ignore */
      }
    }
    delete idx.files[id];
    this.layout.saveIndex(idx);
    return removed;
  }

  // ----------------------------------------

  private writeGraphView(
    k: GraphKnowledgeView,
    rel: string,
    oldRel?: string,
  ): 'written' | 'skipped' | 'moved' {
    const absNew = this.layout.absolutePath(rel);
    let moved: 'moved' | undefined;
    let preservedUserNotes: string | undefined;
    if (oldRel && oldRel !== rel) {
      const absOld = this.layout.absolutePath(oldRel);
      if (fs.existsSync(absOld)) {
        const text = readTextIfExists(absOld);
        if (text) preservedUserNotes = parseMarkdown(text)?.userNotes;
        moved = 'moved';
      }
    }

    let existingBodyHash: string | undefined;
    if (fs.existsSync(absNew)) {
      const text = readTextIfExists(absNew);
      if (text) {
        const parsed = parseMarkdown(text);
        if (parsed) {
          if (preservedUserNotes === undefined) preservedUserNotes = parsed.userNotes;
          existingBodyHash = parsed.frontmatter.bodyHash;
        }
      }
    }

    const out = serializeGraphKnowledge(k, {
      preserveUserNotes: preservedUserNotes,
      locale: this.locale,
    });
    const newBodyHash = computeBodyHash(out);
    if (existingBodyHash && existingBodyHash === newBodyHash && !moved) {
      return 'skipped';
    }

    this.layout.ensureDirFor(rel);
    writeFileAtomically(absNew, out);
    this.removeMovedSource(oldRel, rel);
    return moved ?? 'written';
  }

  private removeMovedSource(oldRel: string | undefined, rel: string): void {
    if (!oldRel || oldRel === rel) return;
    const absOld = this.layout.absolutePath(oldRel);
    if (fs.existsSync(absOld)) {
      fs.unlinkSync(absOld);
    }
  }
}

function writeFileAtomically(filePath: string, text: string): void {
  if (text.length === 0) {
    throw new Error(`Refusing to write empty Obsidian export: ${filePath}`);
  }
  const tmpPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmpPath, text, 'utf8');
  fs.renameSync(tmpPath, filePath);
}
