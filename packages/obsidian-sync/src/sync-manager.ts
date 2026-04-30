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
 *   // Later, after graph mutations:
 *   sync.exportGraphView(view);
 *   sync.removeOne(id);
 *
 *   await sync.stop();
 */

import { type GraphKnowledgeView, type Mindstrate } from '@mindstrate/server';
import { VaultLayout } from './vault-layout.js';
import { VaultExporter, type ExportResult } from './exporter.js';
import { VaultWatcher, type SyncEvent } from './watcher.js';
import { computeBodyHash, serializeGraphKnowledge } from './markdown.js';

export interface SyncManagerOptions {
  vaultRoot: string;
  /** Debounce window for watcher events (ms). Default 500. */
  debounceMs?: number;
  /** Suppress console logs */
  silent?: boolean;
  /** Markdown language for generated labels. Defaults to MINDSTRATE_LOCALE or English. */
  locale?: string;
  /** Callback invoked after each watcher-driven sync */
  onWatchEvent?: (event: SyncEvent) => void;
}

export class SyncManager {
  readonly layout: VaultLayout;
  readonly exporter: VaultExporter;
  readonly watcher: VaultWatcher;
  private memory: Mindstrate;
  private locale?: string;

  constructor(memory: Mindstrate, opts: SyncManagerOptions) {
    this.memory = memory;
    this.locale = opts.locale ?? process.env.MINDSTRATE_LOCALE;
    this.layout = new VaultLayout({ vaultRoot: opts.vaultRoot });
    this.exporter = new VaultExporter({
      layout: this.layout,
      silent: opts.silent,
      locale: this.locale,
    });
    this.watcher = new VaultWatcher(memory, {
      layout: this.layout,
      debounceMs: opts.debounceMs,
      silent: opts.silent,
      locale: this.locale,
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

  exportGraphView(k: GraphKnowledgeView): 'written' | 'skipped' | 'moved' {
    const res = this.exporter.exportGraphView(k);
    const rel = this.layout.relativePathForGraphView(k);
    const text = serializeGraphKnowledge(k, { locale: this.locale });
    this.watcher.markWritten(rel, computeBodyHash(text));
    return res;
  }

  /** Incrementally delete a single knowledge file. */
  removeOne(id: string): boolean {
    return this.exporter.removeOne(id);
  }

  /** Begin watching the vault for changes. */
  startWatching(): void {
    this.watcher.start();
  }

  async stop(): Promise<void> {
    await this.watcher.stop();
  }
}
