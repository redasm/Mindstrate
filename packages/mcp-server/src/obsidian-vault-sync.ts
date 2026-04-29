import type pino from 'pino';

export type VaultSync = {
  exportAll(): Promise<{ written: number; removed: number }>;
  startWatching(): void;
  stop(): Promise<void>;
};

interface VaultSyncOptions {
  obsidianVaultPath: string;
  obsidianAutoSync: boolean;
  obsidianWatch: boolean;
  logger: pino.Logger;
}

export async function startVaultSync(
  localMemory: unknown,
  options: VaultSyncOptions,
): Promise<VaultSync | null> {
  if (!options.obsidianVaultPath || !options.obsidianAutoSync) return null;
  try {
    const { SyncManager } = await import('@mindstrate/obsidian-sync');
    const vaultSync = new SyncManager(localMemory as any, {
      vaultRoot: options.obsidianVaultPath,
      silent: true,
    }) as VaultSync;
    const result = await vaultSync.exportAll();
    options.logger.info(
      { written: result.written, removed: result.removed, vaultPath: options.obsidianVaultPath },
      'Obsidian vault synced',
    );
    if (options.obsidianWatch) {
      vaultSync.startWatching();
      options.logger.info({ vaultPath: options.obsidianVaultPath }, 'Obsidian vault watcher started');
    }
    return vaultSync;
  } catch (err) {
    options.logger.warn({ err }, 'Obsidian vault sync unavailable (package missing or initial sync failed)');
    return null;
  }
}
