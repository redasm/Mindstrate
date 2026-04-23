/**
 * SyncManager: high-level facade for bidirectional sync between
 * a Mindstrate instance and an Obsidian vault.
 *
 * Usage:
 *   const memory = new Mindstrate();
 *   await memory.init();
 *   const sync = new SyncManager(memory, { vaultRoot: '/path/to/vault' });
 *   await sync.exportAll();   // initial Mindstrate -> vault snapshot
 *   sync.startWatching();     // pick up edits made in Obsidian
 *
 *   // Later, after Mindstrate mutations:
 *   sync.exportOne(knowledge);
 *   sync.removeOne(id);
 *
 *   await sync.stop();
 */

import { type Mindstrate, type KnowledgeUnit, type KnowledgeMutationSink } from '@mindstrate/server';
import { VaultLayout } from './vault-layout.js';
import { VaultExporter, type ExportResult } from './exporter.js';
import { VaultWatcher, type SyncEvent } from './watcher.js';
import { computeBodyHash, serializeKnowledge } from './markdown.js';

export interface SyncManagerOptions {
  vaultRoot: string;
  /** Debounce window for watcher events (ms). Default 500. */
  debounceMs?: number;
  /** Suppress console logs */
  silent?: boolean;
  /** Callback invoked after each watcher-driven sync */
  onWatchEvent?: (event: SyncEvent) => void;
}

export class SyncManager implements KnowledgeMutationSink {
  readonly layout: VaultLayout;
  readonly exporter: VaultExporter;
  readonly watcher: VaultWatcher;
  private memory: Mindstrate;

  constructor(memory: Mindstrate, opts: SyncManagerOptions) {
    this.memory = memory;
    this.layout = new VaultLayout({ vaultRoot: opts.vaultRoot });
    this.exporter = new VaultExporter({ layout: this.layout, silent: opts.silent });
    this.watcher = new VaultWatcher(memory, {
      layout: this.layout,
      debounceMs: opts.debounceMs,
      silent: opts.silent,
      onSync: opts.onWatchEvent,
    });
  }

  /** Full export of the entire Mindstrate database into the vault. */
  async exportAll(): Promise<ExportResult> {
    const r = await this.exporter.exportAll(this.memory);
    // Re-prime watcher hashes from disk so we don't react to our own writes.
    this.watcher.primeFromVault();
    return r;
  }

  /**
   * Incrementally write a single knowledge unit.
   * Also marks the resulting file as known to the watcher so it won't echo back.
   */
  exportOne(k: KnowledgeUnit): 'written' | 'skipped' | 'moved' {
    const res = this.exporter.exportOne(k);
    // Mark watcher as already-having-seen this hash to avoid loop
    const rel = this.layout.relativePath(k);
    const text = serializeKnowledge(k);
    this.watcher.markWritten(rel, computeBodyHash(text));
    return res;
  }

  /** Incrementally delete a single knowledge file. */
  removeOne(id: string): boolean {
    return this.exporter.removeOne(id);
  }

  // ----- KnowledgeMutationSink implementation -----

  onAdded(k: KnowledgeUnit): void {
    this.exportOne(k);
  }

  onUpdated(k: KnowledgeUnit): void {
    this.exportOne(k);
  }

  onDeleted(id: string): void {
    this.removeOne(id);
  }

  /** Begin watching the vault for changes. */
  startWatching(): void {
    this.watcher.start();
  }

  async stop(): Promise<void> {
    await this.watcher.stop();
  }
}
