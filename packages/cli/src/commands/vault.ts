/**
 * mindstrate vault - Manage Obsidian vault sync
 *
 * Subcommands:
 *   mindstrate vault init <path>     Configure & seed vault (writes .env hint, creates folders)
 *   mindstrate vault export [path]   One-shot full export of Mindstrate into the vault
 *   mindstrate vault watch [path]    Long-running bidirectional sync (Ctrl+C to stop)
 *   mindstrate vault status [path]   Show vault stats (file count, last sync, drift)
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { Command } from 'commander';
import { KnowledgeType, Mindstrate, type GraphKnowledgeView } from '@mindstrate/server';
import {
  SyncManager,
  VaultLayout,
  assessCanonicalSourceReadiness,
  graphDomainToKnowledgeType,
  getVaultSyncMode,
} from '@mindstrate/obsidian-sync';
import { readProjectCliConfig, resolveProjectDataDir, writeProjectCliConfig } from '../cli-config.js';

function graphViewToKnowledgeType(view: GraphKnowledgeView): KnowledgeType {
  return graphDomainToKnowledgeType(String(view.domainType));
}

function resolveVaultPath(provided?: string): string {
  const p = provided
    ?? process.env['OBSIDIAN_VAULT_PATH']
    ?? '';
  if (!p) {
    console.error('Error: vault path not provided.');
    console.error('  Usage: mindstrate vault <cmd> <path>');
    console.error('  Or set environment variable OBSIDIAN_VAULT_PATH');
    process.exit(1);
  }
  return path.resolve(p);
}

const initCmd = new Command('init')
  .description('Initialize an Obsidian vault for Mindstrate sync')
  .argument('<path>', 'Vault root directory')
  .action(async (vaultPath: string) => {
    const root = path.resolve(vaultPath);
    if (!fs.existsSync(root)) {
      fs.mkdirSync(root, { recursive: true });
      console.log(`Created vault directory: ${root}`);
    }
    const layout = new VaultLayout({ vaultRoot: root });
    layout.ensureRoot();
    // Seed README
    const readmePath = path.join(root, 'README.md');
    if (!fs.existsSync(readmePath)) {
      fs.writeFileSync(
        readmePath,
        '# Mindstrate Knowledge Vault\n\n' +
        'This Obsidian vault is automatically synchronized with Mindstrate.\n\n' +
        '- Knowledge files live under `<project>/<type>/<title>--<id>.md`.\n' +
        '- The `_meta/` folder stores sync metadata (do not edit).\n' +
        '- Edits made in Obsidian are mirrored back to the Mindstrate database.\n' +
        '- Content below the `<!-- mindstrate:end -->` marker is treated as your private notes ' +
        'and is preserved (not synced).\n',
        'utf8',
      );
      console.log('Wrote README.md');
    }
    console.log('\nVault ready. Next steps:');
    console.log(`  1. Set environment variable:  OBSIDIAN_VAULT_PATH=${root}`);
    console.log('  2. Initial export:            mindstrate vault export');
    console.log('  3. Bidirectional sync:        mindstrate vault watch');
  });

const exportCmd = new Command('export')
  .description('Full export of all knowledge into the vault (one-shot)')
  .argument('[path]', 'Vault root directory (or use OBSIDIAN_VAULT_PATH)')
  .option('-d, --data-dir <path>', 'Mindstrate data directory (defaults to current project .mindstrate when present)')
  .action(async (vaultPath: string | undefined, options: { dataDir?: string }) => {
    const root = resolveVaultPath(vaultPath);
    const dataDir = resolveProjectDataDir(process.cwd(), options.dataDir);
    const memory = new Mindstrate(dataDir ? { dataDir } : undefined);
    await memory.init();
    writeProjectCliConfig(process.cwd(), {
      ...(readProjectCliConfig(process.cwd()) ?? {}),
      vaultPath: root,
    });
    const sync = new SyncManager(memory, { vaultRoot: root });
    const r = await sync.exportAll();
    console.log(`\nExport complete:`);
    console.log(`  written: ${r.written}  (moved: ${r.moved})`);
    console.log(`  skipped: ${r.skipped}`);
    console.log(`  removed: ${r.removed}`);
    if (r.errors.length) {
      console.log(`  errors:  ${r.errors.length}`);
      for (const e of r.errors.slice(0, 5)) console.log(`    [${e.id}] ${e.error}`);
    }
    memory.close();
  });

const watchCmd = new Command('watch')
  .description('Bidirectional sync: export then watch the vault for edits')
  .argument('[path]', 'Vault root directory (or use OBSIDIAN_VAULT_PATH)')
  .option('--debounce <ms>', 'Debounce window for file events', '500')
  .option('-d, --data-dir <path>', 'Mindstrate data directory (defaults to current project .mindstrate when present)')
  .action(async (vaultPath: string | undefined, options) => {
    const root = resolveVaultPath(vaultPath);
    const dataDir = resolveProjectDataDir(process.cwd(), options.dataDir);
    const memory = new Mindstrate(dataDir ? { dataDir } : undefined);
    await memory.init();
    writeProjectCliConfig(process.cwd(), {
      ...(readProjectCliConfig(process.cwd()) ?? {}),
      vaultPath: root,
    });
    const sync = new SyncManager(memory, {
      vaultRoot: root,
      debounceMs: Number(options.debounce) || 500,
    });

    console.log(`Vault: ${root}`);
    console.log('Performing initial export...');
    const r = await sync.exportAll();
    console.log(
      `  wrote ${r.written} (moved ${r.moved}), skipped ${r.skipped}, removed ${r.removed}, errors ${r.errors.length}\n`,
    );

    sync.startWatching();
    console.log('Watching for changes. Press Ctrl+C to stop.\n');

    const shutdown = async () => {
      console.log('\nStopping...');
      await sync.stop();
      memory.close();
      process.exit(0);
    };
    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
  });

const statusCmd = new Command('status')
  .description('Show vault sync status')
  .argument('[path]', 'Vault root directory (or use OBSIDIAN_VAULT_PATH)')
  .option('-d, --data-dir <path>', 'Mindstrate data directory (defaults to current project .mindstrate when present)')
  .action(async (vaultPath: string | undefined, options: { dataDir?: string }) => {
    const root = resolveVaultPath(vaultPath);
    const layout = new VaultLayout({ vaultRoot: root });
    if (!fs.existsSync(root)) {
      console.error(`Vault does not exist: ${root}`);
      process.exit(1);
    }
    const idx = layout.loadIndex();
    const files = layout.walkMarkdownFiles();
    console.log(`Vault:           ${root}`);
    console.log(`Indexed entries: ${Object.keys(idx.files).length}`);
    console.log(`Markdown files:  ${files.length}`);
    if (idx.lastFullSyncAt) {
      console.log(`Last full sync:  ${idx.lastFullSyncAt}`);
    } else {
      console.log('Last full sync:  never (run `mindstrate vault export` first)');
    }
    const dataDir = resolveProjectDataDir(process.cwd(), options.dataDir);
    const memory = new Mindstrate(dataDir ? { dataDir } : undefined);
    await memory.init();
    const stats = await memory.maintenance.getStats();
    const graphKnowledge = memory.context.readGraphKnowledge({ limit: 100000 });
    const editableKnowledge = graphKnowledge.filter((view) => getVaultSyncMode(graphViewToKnowledgeType(view)) === 'editable').length;
    const mirrorKnowledge = graphKnowledge.length - editableKnowledge;
    const assessment = assessCanonicalSourceReadiness({
      totalKnowledge: stats.total,
      indexedEntries: Object.keys(idx.files).length,
      markdownFiles: files.length,
      editableKnowledge,
      mirrorKnowledge,
      hasMirrorProtection: true,
      hasStaleEditProtection: true,
      hasVersionedMerge: false,
      hasTeamConflictResolution: false,
    });
    console.log(`Mindstrate total KUs:    ${stats.total}`);
    const drift = stats.total - Object.keys(idx.files).length;
    if (drift !== 0) {
      console.log(`\nDrift:           ${drift > 0 ? '+' : ''}${drift} (run \`mindstrate vault export\` to reconcile)`);
    }
    console.log('\nCanonical-source readiness:');
    console.log(`  Level:                ${assessment.level}`);
    console.log(`  Editable knowledge:   ${assessment.summary.editableKnowledge}`);
    console.log(`  Mirror knowledge:     ${assessment.summary.mirrorKnowledge}`);
    if (assessment.blockers.length > 0) {
      console.log('  Blockers:');
      for (const blocker of assessment.blockers) {
        console.log(`    - ${blocker}`);
      }
    }
    console.log(`  Recommendation:       ${assessment.recommendation}`);
    memory.close();
  });

export const vaultCommand = new Command('vault')
  .description('Manage Obsidian vault synchronization')
  .addCommand(initCmd)
  .addCommand(exportCmd)
  .addCommand(watchCmd)
  .addCommand(statusCmd);
