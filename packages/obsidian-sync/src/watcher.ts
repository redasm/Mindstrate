/**
 * VaultWatcher: watches the Obsidian vault for changes and applies them back into Mindstrate.
 *
 * Behavior:
 *  - On change/add: parse the markdown, look up the KU by frontmatter id.
 *      - If KU exists and body changed -> Mindstrate.update(...) (re-embedding handled by re-add path optionally).
 *      - If KU does not exist          -> create a new KU with the parsed content (id from frontmatter is informational; Mindstrate mints its own).
 *  - On unlink: delete the KU from Mindstrate (only when filename had a known id from index).
 *
 * Loop prevention:
 *  - We track the last bodyHash we wrote per file path; if a change matches a bodyHash
 *    we just emitted, ignore it. The exporter writes use the same hash so this catches
 *    self-triggered events.
 *  - A debounce window (default 500ms) coalesces rapid editor saves.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import chokidar, { type FSWatcher } from 'chokidar';
import {
  type Mindstrate,
  type KnowledgeUnit,
} from '@mindstrate/server';
import {
  parseMarkdown,
  parsedToCreate,
  parsedToUpdate,
  computeBodyHash,
  serializeKnowledge,
  getVaultSyncMode,
} from './markdown.js';
import { VaultLayout, extractIdSuffixFromFilename, idMatchesSuffix } from './vault-layout.js';

export interface VaultWatcherOptions {
  layout: VaultLayout;
  /** Debounce window for file events (ms). Default 500. */
  debounceMs?: number;
  /** Suppress logs */
  silent?: boolean;
  /** Callback invoked after each successful sync */
  onSync?: (event: SyncEvent) => void;
}

export interface SyncEvent {
  type: 'updated' | 'created' | 'deleted' | 'ignored' | 'error';
  relPath: string;
  knowledgeId?: string;
  message?: string;
}

export class VaultWatcher {
  private layout: VaultLayout;
  private memory: Mindstrate;
  private watcher: FSWatcher | null = null;
  private debounceMs: number;
  private silent: boolean;
  private onSync?: (event: SyncEvent) => void;

  /** rel path -> body hash that *we* (or a recent successful sync) last persisted */
  private knownHashes = new Map<string, string>();
  /** rel path -> pending debounce timer */
  private pending = new Map<string, NodeJS.Timeout>();

  constructor(memory: Mindstrate, opts: VaultWatcherOptions) {
    this.memory = memory;
    this.layout = opts.layout;
    this.debounceMs = opts.debounceMs ?? 500;
    this.silent = opts.silent ?? false;
    this.onSync = opts.onSync;
  }

  /**
   * Prime the known-hash map from existing vault files. Call this right after
   * the exporter finishes a full export so that we don't immediately re-process
   * files we just wrote.
   */
  primeFromVault(): void {
    const files = this.layout.walkMarkdownFiles();
    for (const rel of files) {
      const abs = this.layout.absolutePath(rel);
      const text = safeRead(abs);
      if (!text) continue;
      this.knownHashes.set(rel, computeBodyHash(text));
    }
  }

  /** Mark a file as just-written (so the resulting fs event is ignored). */
  markWritten(relPath: string, bodyHash: string): void {
    this.knownHashes.set(relPath, bodyHash);
  }

  start(): void {
    if (this.watcher) return;
    this.layout.ensureRoot();
    this.watcher = chokidar.watch(this.layout.root, {
      ignored: (p) => this.shouldIgnore(p),
      persistent: true,
      ignoreInitial: true,
      awaitWriteFinish: { stabilityThreshold: 200, pollInterval: 50 },
    });

    this.watcher
      .on('add', (p) => this.schedule(p, 'add'))
      .on('change', (p) => this.schedule(p, 'change'))
      .on('unlink', (p) => this.handleUnlink(p))
      .on('error', (err) => {
        if (!this.silent) console.error('[obsidian-sync] watcher error:', err);
      });

    if (!this.silent) console.error(`[obsidian-sync] watching ${this.layout.root}`);
  }

  async stop(): Promise<void> {
    for (const t of this.pending.values()) clearTimeout(t);
    this.pending.clear();
    if (this.watcher) {
      await this.watcher.close();
      this.watcher = null;
    }
  }

  // ----------------------------------------

  private shouldIgnore(p: string): boolean {
    if (this.layout.isMetaPath(p)) return true;
    const base = path.basename(p);
    if (base.startsWith('.') && base !== '.') return true;
    // Only watch markdown files (and directories we need to traverse)
    try {
      const stat = fs.statSync(p);
      if (stat.isDirectory()) return false;
    } catch {
      // doesn't exist yet
    }
    if (!base.endsWith('.md')) return true;
    return false;
  }

  private schedule(absPath: string, _kind: 'add' | 'change'): void {
    const rel = this.toRel(absPath);
    if (!rel) return;
    const existing = this.pending.get(rel);
    if (existing) clearTimeout(existing);
    const t = setTimeout(() => {
      this.pending.delete(rel);
      this.handleAddOrChange(rel).catch((err) => {
        this.emit({ type: 'error', relPath: rel, message: errMsg(err) });
      });
    }, this.debounceMs);
    this.pending.set(rel, t);
  }

  private async handleAddOrChange(rel: string): Promise<void> {
    const abs = this.layout.absolutePath(rel);
    const text = safeRead(abs);
    if (text === null) return;
    const hash = computeBodyHash(text);
    const known = this.knownHashes.get(rel);
    if (known && known === hash) {
      // self-triggered or no actual content change
      return;
    }

    const parsed = parseMarkdown(text);
    if (!parsed) {
      this.emit({ type: 'ignored', relPath: rel, message: 'No valid frontmatter' });
      return;
    }

    if (parsed.frontmatter.syncMode === 'mirror') {
      this.emit({ type: 'ignored', relPath: rel, message: 'Vault edits disabled for mirror-only knowledge' });
      return;
    }

    const id = parsed.frontmatter.id;
    const existing = this.findByIdOrSuffix(id, rel);
    if (existing) {
      const currentHash = computeBodyHash(serializeKnowledge(existing));
      if (
        parsed.frontmatter.bodyHash
        && parsed.frontmatter.bodyHash !== currentHash
        && parsed.frontmatter.updatedAt
        && new Date(existing.metadata.updatedAt).getTime() > new Date(parsed.frontmatter.updatedAt).getTime()
      ) {
        this.emit({ type: 'ignored', relPath: rel, knowledgeId: existing.id, message: 'Stale vault edit conflicts with newer Mindstrate content' });
        return;
      }
      // Update path
      const update = parsedToUpdate(parsed);
      const maybeReindexingMemory = this.memory as Mindstrate & {
        updateAndReindex?: (id: string, input: ReturnType<typeof parsedToUpdate>) => Promise<KnowledgeUnit | null>;
      };
      if (maybeReindexingMemory.updateAndReindex) {
        await maybeReindexingMemory.updateAndReindex(existing.id, update);
      } else {
        this.memory.update(existing.id, update);
      }
      this.knownHashes.set(rel, hash);
      this.emit({ type: 'updated', relPath: rel, knowledgeId: existing.id });
      return;
    }

    // No existing KU -> create
    const create = parsedToCreate(parsed);
    const result = await this.memory.add(create);
    if (result.success && result.knowledge) {
      this.knownHashes.set(rel, hash);
      this.emit({ type: 'created', relPath: rel, knowledgeId: result.knowledge.id });
    } else {
      this.emit({
        type: 'ignored',
        relPath: rel,
        message: result.message || 'add failed',
      });
    }
  }

  private handleUnlink(absPath: string): void {
    const rel = this.toRel(absPath);
    if (!rel) return;
    // Need to discover which KU this file represented.
    // 1) Look up vault index, 2) Fall back to id-suffix in filename.
    const idx = this.layout.loadIndex();
    let knowledgeId: string | undefined;
    for (const [kid, krel] of Object.entries(idx.files)) {
      if (krel === rel) {
        knowledgeId = kid;
        break;
      }
    }
    if (!knowledgeId) {
      const base = path.basename(rel);
      const suffix = extractIdSuffixFromFilename(base);
      if (suffix) {
        const all = this.memory.list({}, 100000);
        const match = all.find((k) => idMatchesSuffix(k.id, suffix));
        knowledgeId = match?.id;
      }
    }

    if (!knowledgeId) {
      this.emit({ type: 'ignored', relPath: rel, message: 'unlink: no knowledge id resolvable' });
      return;
    }

    const existing = this.memory.get(knowledgeId);
    if (existing && getVaultSyncMode(existing.type) === 'mirror') {
      this.knownHashes.delete(rel);
      this.emit({
        type: 'ignored',
        relPath: rel,
        knowledgeId,
        message: 'Vault deletes disabled for mirror-only knowledge',
      });
      return;
    }

    this.memory.delete(knowledgeId).then((deleted) => {
      this.knownHashes.delete(rel);
      // Also drop from index
      const idx2 = this.layout.loadIndex();
      delete idx2.files[knowledgeId!];
      this.layout.saveIndex(idx2);
      this.emit({
        type: deleted ? 'deleted' : 'ignored',
        relPath: rel,
        knowledgeId,
        message: deleted ? undefined : 'no such knowledge in Mindstrate',
      });
    }).catch((err) => {
      this.emit({ type: 'error', relPath: rel, knowledgeId, message: errMsg(err) });
    });
  }

  private findByIdOrSuffix(id: string, rel: string): KnowledgeUnit | null {
    if (id) {
      // Try exact / prefix match via the Mindstrate facade (uses SQL LIKE under the hood)
      const exact = this.memory.findByIdOrPrefix(id);
      if (exact) return exact;
    }
    // Fall back to filename suffix
    const base = path.basename(rel);
    const suffix = extractIdSuffixFromFilename(base);
    if (!suffix) return null;
    const candidate = this.memory.findByIdOrPrefix(suffix);
    return candidate;
  }

  private toRel(absPath: string): string | null {
    const root = this.layout.root;
    if (!absPath.startsWith(root)) return null;
    const r = path.relative(root, absPath).split(path.sep).join('/');
    return r;
  }

  private emit(ev: SyncEvent): void {
    if (!this.silent) {
      const tag = ev.type.toUpperCase();
      const idPart = ev.knowledgeId ? ` (${ev.knowledgeId.slice(0, 8)})` : '';
      const msgPart = ev.message ? ` -- ${ev.message}` : '';
      console.error(`[obsidian-sync] ${tag} ${ev.relPath}${idPart}${msgPart}`);
    }
    this.onSync?.(ev);
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
