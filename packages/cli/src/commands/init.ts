/**
 * mindstrate init — Initialize Mindstrate in a project (idempotent)
 *
 * Detects the project, builds a project-snapshot knowledge unit so AI
 * assistants always have the global mental model of the codebase, and
 * (optionally) wires up MCP / Obsidian vault.
 *
 * Re-running `mindstrate init` updates the same snapshot in place; user-edited
 * sections (Architecture, Critical Invariants, Conventions, Notes) are
 * preserved verbatim across runs.
 */

import { Command } from 'commander';
import * as path from 'node:path';
import * as fs from 'node:fs';
import {
  Mindstrate,
  detectProject,
  errorMessage,
  loadProjectMeta,
  saveProjectMeta,
  dependencyFingerprint,
  metaPath,
  type DetectedProject,
  type ProjectMeta,
} from '@mindstrate/server';
import { writeMcpConfig } from './setup-mcp.js';
import { writeProjectCliConfig } from '../cli-config.js';

interface InitOptions {
  dataDir?: string;
  cwd?: string;
  noSnapshot?: boolean;
  noGraph?: boolean;
  force?: boolean;
  withVault?: string;
  tool?: 'cursor' | 'opencode' | 'claude-desktop' | 'all';
  globalMcp?: boolean;
}

export const initCommand = new Command('init')
  .description('Initialize Mindstrate in the current project (idempotent)')
  .option('-d, --data-dir <path>', 'Custom data directory')
  .option('-C, --cwd <path>', 'Run as if invoked in this directory')
  .option('--no-snapshot', 'Skip generating the project snapshot KU')
  .option('--no-graph', 'Skip deterministic project graph indexing')
  .option('--force', 'Force-rebuild snapshot even if no changes detected')
  .option('--with-vault <path>', 'Also initialize an Obsidian vault at this path')
  .option('--tool <tool>', 'Also generate MCP config for: cursor, opencode, claude-desktop, all')
  .option('--global-mcp', 'When --tool=claude-desktop, install in user Claude dir', false)
  .action(async (options: InitOptions) => {
    const cwd = path.resolve(options.cwd ?? process.cwd());

    try {
      console.log('Initializing Mindstrate...\n');

      // 1) Detect project
      const project = detectProject(cwd);
      if (!project) {
        console.error('Could not detect a project at:', cwd);
        process.exit(1);
      }
      printDetected(project);

      // 2) Initialize the data store (default per-project under ./.mindstrate)
      const dataDir = options.dataDir ?? path.join(project.root, '.mindstrate');
      const memory = new Mindstrate({ dataDir });
      await memory.init();

      const config = memory.getConfig();
      console.log('\nStorage:');
      console.log(`  Data:   ${config.dataDir}`);
      console.log(`  DB:     ${config.dbPath}`);
      console.log(`  Vector: ${config.vectorStorePath}`);

      // 3) Load / merge project metadata
      const previousMeta = loadProjectMeta(project.root);
      const fingerprint = dependencyFingerprint({
        language: project.language,
        framework: project.framework,
        dependencies: project.dependencies,
      });
      const metaIsNew = !previousMeta;
      const fingerprintChanged = previousMeta?.fingerprint !== fingerprint;
      const now = new Date().toISOString();

      const meta: ProjectMeta = {
        version: 1,
        name: project.name,
        rootHint: project.root,
        language: project.language,
        framework: project.framework,
        snapshotKnowledgeId: previousMeta?.snapshotKnowledgeId,
        createdAt: previousMeta?.createdAt ?? now,
        updatedAt: now,
        fingerprint,
      };

      // 4) Project snapshot KU (optional but recommended)
      let snapshotSummary = '';
      if (options.noSnapshot) {
        snapshotSummary = '  (skipped: --no-snapshot)';
      } else if (!fingerprintChanged && !metaIsNew && !options.force) {
        // Stack identical -> still call upsert so freshly-introduced preserve
        // sections come into existence; the body hash check inside will skip
        // a no-op write. But we surface the "no change" status to the user.
        const result = await memory.snapshots.upsertProjectSnapshot(project, { author: 'mindstrate-init' });
        snapshotSummary = result.changed
          ? `  Updated: ${result.view.id}`
          : `  Up-to-date: ${result.view.id}`;
        meta.snapshotKnowledgeId = result.view.id;
      } else {
        const result = await memory.snapshots.upsertProjectSnapshot(project, { author: 'mindstrate-init' });
        meta.snapshotKnowledgeId = result.view.id;
        if (result.created) {
          snapshotSummary = `  Created: ${result.view.id}`;
        } else {
          snapshotSummary = `  Updated: ${result.view.id} (stack changed)`;
        }
      }

      console.log('\nProject snapshot:');
      console.log(snapshotSummary);

      // 5) Deterministic project graph
      if (options.noGraph) {
        console.log('\nProject graph:');
        console.log('  (skipped: --no-graph)');
      } else {
        const graph = memory.context.indexProjectGraph(project);
        console.log('\nProject graph:');
        console.log(`  Files: ${graph.filesScanned}`);
        console.log(`  Nodes: ${graph.nodesCreated} created, ${graph.nodesUpdated} updated`);
        console.log(`  Edges: ${graph.edgesCreated} created, ${graph.edgesSkipped} unchanged`);
      }

      // 6) Write project meta file (always, for ownership + fingerprint cache)
      saveProjectMeta(project.root, meta);
      writeProjectCliConfig(project.root, {
        mode: process.env['TEAM_SERVER_URL'] ? 'team' : 'local',
        tool: options.tool === 'all' ? undefined : options.tool,
        vaultPath: options.withVault,
        teamServerUrl: process.env['TEAM_SERVER_URL'],
      });
      console.log(`  Meta:    ${metaPath(project.root)}`);

      // 7) Optional: Obsidian vault
      if (options.withVault) {
        await initVault(memory, options.withVault, project);
      }

      // 8) Optional: MCP config
      if (options.tool) {
        try {
          const { generated, serverPath } = writeMcpConfig({
            tool: options.tool,
            cwd: project.root,
            global: options.globalMcp,
          });
          console.log('\nMCP config:');
          for (const g of generated) console.log(`  ${g}`);
          console.log(`  Server:  ${serverPath}`);
        } catch (err) {
          console.warn(`\nMCP config skipped: ${err instanceof Error ? err.message : err}`);
        }
      }

      // 9) Mode hints
      printModeHints(project, options);

      // 10) OPENAI_API_KEY warning
      if (!config.openaiApiKey) {
        console.log('\n  Note: OPENAI_API_KEY not set — falling back to local hash-based embeddings.');
        console.log('  Set it in your environment for higher-quality semantic search.');
      }

      memory.close();
      console.log('\nDone.');
    } catch (error) {
      console.error('Failed to initialize:', errorMessage(error));
      process.exit(1);
    }
  });

function printDetected(p: DetectedProject): void {
  console.log('Detected project:');
  console.log(`  Name:       ${p.name}`);
  console.log(`  Root:       ${p.root}`);
  if (p.language) console.log(`  Language:   ${p.language}`);
  if (p.framework) console.log(`  Framework:  ${p.framework}`);
  if (p.runtime) console.log(`  Runtime:    ${p.runtime}`);
  if (p.packageManager) console.log(`  Pkg mgr:    ${p.packageManager}`);
  if (p.manifestPath) console.log(`  Manifest:   ${p.manifestPath}`);
  if (p.git?.isRepo) console.log(`  Git branch: ${p.git.branch ?? '(unknown)'}`);
  if (p.dependencies.length) {
    console.log(`  Deps:       ${p.dependencies.length} (${p.truncatedDeps > 0 ? '+' + p.truncatedDeps + ' truncated' : 'all included'})`);
  }
  if (p.entryPoints.length) {
    console.log(`  Entries:    ${p.entryPoints.slice(0, 3).join(', ')}${p.entryPoints.length > 3 ? ', …' : ''}`);
  }
}

async function initVault(memory: Mindstrate, vaultPath: string, project: DetectedProject): Promise<void> {
  // Lazily import obsidian-sync so the CLI can still run when the package
  // is unavailable in some downstream packaging scenarios.
  let SyncManager: any;
  let VaultLayout: any;
  try {
    ({ SyncManager, VaultLayout } = await import('@mindstrate/obsidian-sync'));
  } catch (err) {
    console.warn(`\nVault sync skipped (@mindstrate/obsidian-sync not available): ${errorMessage(err)}`);
    return;
  }

  const root = path.resolve(vaultPath);
  if (!fs.existsSync(root)) {
    fs.mkdirSync(root, { recursive: true });
  }
  const layout = new VaultLayout({ vaultRoot: root });
  layout.ensureRoot();

  const sync = new SyncManager(memory, { vaultRoot: root, silent: true });
  const r = await sync.exportAll();

  console.log('\nObsidian vault:');
  console.log(`  Path:    ${root}`);
  console.log(`  Synced:  ${r.written} written, ${r.skipped} skipped, ${r.removed} removed`);
  console.log(`  Project: ${project.name}/architecture/`);
}

function printModeHints(project: DetectedProject, options: InitOptions): void {
  const hasTeamUrl = !!process.env['TEAM_SERVER_URL'];
  const hasVaultPath = !!process.env['OBSIDIAN_VAULT_PATH'] || !!options.withVault;

  console.log('\nNext steps:');
  if (hasTeamUrl) {
    console.log(`  • Team mode active — \`${project.name}\` snapshot is now visible to teammates.`);
  } else if (hasVaultPath) {
    console.log(`  • Vault mode — browse \`${project.name}\` in Obsidian; edits sync back to Mindstrate.`);
  } else {
    console.log('  • Local mode. To share knowledge across machines, choose one:');
    console.log('      - Team: set TEAM_SERVER_URL=http://your-server:3388 and TEAM_API_KEY=...');
    console.log('      - Personal Obsidian: mindstrate vault init <path> && set OBSIDIAN_VAULT_PATH=...');
  }
  if (!options.tool) {
    console.log('  • Wire up an AI tool: mindstrate init --tool opencode  (or cursor / claude-desktop)');
  }
  console.log('  • Add knowledge:        mindstrate add');
  console.log('  • Search:               mindstrate search "<query>"');
  console.log('  • Re-run safely:        mindstrate init   (idempotent; preserves your edits)');
}
