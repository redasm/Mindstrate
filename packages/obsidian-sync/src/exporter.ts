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
 */

import * as fs from 'node:fs';
import {
  type GraphKnowledgeView,
  type Mindstrate,
  type KnowledgeUnit,
} from '@mindstrate/server';
import {
  serializeGraphKnowledge,
  serializeKnowledge,
  parseMarkdown,
  computeBodyHash,
} from './markdown.js';
import { VaultLayout, type VaultIndex } from './vault-layout.js';

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
}

export class VaultExporter {
  private layout: VaultLayout;
  private silent: boolean;

  constructor(opts: VaultExporterOptions) {
    this.layout = opts.layout;
    this.silent = opts.silent ?? false;
  }

  /**
   * Export the entire Mindstrate database into the vault.
   * Removes vault files whose ids are no longer present in Mindstrate
   * (only inside our managed folders).
   */
  async exportAll(memory: Mindstrate): Promise<ExportResult> {
    this.layout.ensureRoot();
    const result: ExportResult = { written: 0, skipped: 0, removed: 0, moved: 0, errors: [] };

    const all = memory.readGraphKnowledge({ limit: 100000 });
    const idx: VaultIndex = this.layout.loadIndex();
    const newIndex: VaultIndex = { files: {}, version: idx.version, lastFullSyncAt: new Date().toISOString() };

    const desiredAbsPaths = new Set<string>();

    for (const k of all) {
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
        result.errors.push({ id: k.id, error: errMsg(err) });
      }
    }

    // Remove orphan files that were once managed by us but no longer correspond to a KU.
    for (const [oldId, oldRel] of Object.entries(idx.files)) {
      if (!newIndex.files[oldId]) {
        try {
          const abs = this.layout.absolutePath(oldRel);
          if (fs.existsSync(abs)) {
            // Only delete if file still looks like one of ours (has frontmatter id matching)
            const text = safeRead(abs);
            const parsed = text ? parseMarkdown(text) : null;
            if (parsed && parsed.frontmatter.id === oldId) {
              fs.unlinkSync(abs);
              result.removed++;
            }
          }
        } catch (err) {
          result.errors.push({ id: oldId, error: 'remove orphan: ' + errMsg(err) });
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

  /**
   * Write a single knowledge unit. Used for incremental sync after add/update.
   * Updates the vault index in place.
   */
  exportOne(k: KnowledgeUnit): 'written' | 'skipped' | 'moved' {
    this.layout.ensureRoot();
    const idx = this.layout.loadIndex();
    const rel = this.layout.relativePath(k);
    const oldRel = idx.files[k.id];
    const res = this.writeOne(k, rel, oldRel);
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
        const text = safeRead(abs);
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

  private writeOne(
    k: KnowledgeUnit,
    rel: string,
    oldRel?: string,
  ): 'written' | 'skipped' | 'moved' {
    const absNew = this.layout.absolutePath(rel);
    let moved: 'moved' | undefined;

    // If path changed, we may need to move (preserving user notes from old file).
    let preservedUserNotes: string | undefined;
    if (oldRel && oldRel !== rel) {
      const absOld = this.layout.absolutePath(oldRel);
      if (fs.existsSync(absOld)) {
        const text = safeRead(absOld);
        if (text) {
          const parsed = parseMarkdown(text);
          preservedUserNotes = parsed?.userNotes;
        }
        try {
          fs.unlinkSync(absOld);
          moved = 'moved';
        } catch { /* ignore */ }
      }
    }

    // If existing file at new path, parse its user notes and check if body actually changed.
    let existingBodyHash: string | undefined;
    if (fs.existsSync(absNew)) {
      const text = safeRead(absNew);
      if (text) {
        const parsed = parseMarkdown(text);
        if (parsed) {
          if (preservedUserNotes === undefined) preservedUserNotes = parsed.userNotes;
          existingBodyHash = parsed.frontmatter.bodyHash;
        }
      }
    }

    const out = serializeKnowledge(k, { preserveUserNotes: preservedUserNotes });
    const newBodyHash = computeBodyHash(out);

    if (existingBodyHash && existingBodyHash === newBodyHash && !moved) {
      // Body unchanged — but frontmatter (score, status, useCount) may have changed.
      // We still skip, because frontmatter-only diffs would create needless churn
      // and trigger the watcher. Score/usage updates can wait for next full sync.
      return 'skipped';
    }

    this.layout.ensureDirFor(rel);
    fs.writeFileSync(absNew, out, 'utf8');
    return moved ?? 'written';
  }

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
        const text = safeRead(absOld);
        if (text) preservedUserNotes = parseMarkdown(text)?.userNotes;
        try {
          fs.unlinkSync(absOld);
          moved = 'moved';
        } catch { /* ignore */ }
      }
    }

    let existingBodyHash: string | undefined;
    if (fs.existsSync(absNew)) {
      const text = safeRead(absNew);
      if (text) {
        const parsed = parseMarkdown(text);
        if (parsed) {
          if (preservedUserNotes === undefined) preservedUserNotes = parsed.userNotes;
          existingBodyHash = parsed.frontmatter.bodyHash;
        }
      }
    }

    const out = serializeGraphKnowledge(k, { preserveUserNotes: preservedUserNotes });
    const newBodyHash = computeBodyHash(out);
    if (existingBodyHash && existingBodyHash === newBodyHash && !moved) {
      return 'skipped';
    }

    this.layout.ensureDirFor(rel);
    fs.writeFileSync(absNew, out, 'utf8');
    return moved ?? 'written';
  }
}

function safeRead(p: string): string | null {
  try {
    return fs.readFileSync(p, 'utf8');
  } catch {
    return null;
  }
}

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
