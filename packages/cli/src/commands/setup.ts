/**
 * `mindstrate setup` command entry.
 *
 * Thin wrapper around the focused setup modules:
 *   - `setup-prompts`: interactive readers + small input helpers
 *   - `setup-progress`: throttled stdout printers for long-running steps
 *   - `setup-local`: local Mindstrate bootstrap + `.env` plumbing
 *   - `setup-team-deploy`: deploy/.env.deploy generator
 *
 * This file should stay almost mechanical: parse flags, drive prompts,
 * delegate the actual work, then print a final summary.
 */

import * as readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import * as path from 'node:path';
import { Command } from 'commander';
import { detectProject, errorMessage } from '@mindstrate/server';
import {
  buildSetupPlan,
  loadProjectEnv,
  writeProjectCliConfig,
} from '../cli-config.js';
import { writeMcpConfig } from './setup-mcp.js';
import {
  confirm,
  normalizeOptionalPath,
  printBanner,
  readExperience,
  readOptionalVaultPath,
  readTool,
  readValue,
  type SetupOptions,
} from './setup-prompts.js';
import {
  exportVaultDuringSetup,
  initializeLocalProject,
} from './setup-local.js';
import { runTeamDeployWizard } from './setup-team-deploy.js';
import { printStepProgress } from './setup-progress.js';

export const setupCommand = new Command('setup')
  .description('Step-by-step setup wizard for local personal use or team deployment')
  .option('--mode <mode>', 'Setup mode: local, team-client, team-deploy, or team')
  .option('--tool <tool>', 'AI tool: opencode, cursor, claude-desktop, all')
  .option('--vault <path>', 'Obsidian vault path for local personal setup')
  .option('--team-server-url <url>', 'Team Server URL for team mode')
  .option('--team-api-key <key>', 'Team API key for team mode')
  .option('-y, --yes', 'Use defaults for omitted interactive answers', false)
  .action(async (options: SetupOptions) => {
    const cwd = process.cwd();
    const rl = readline.createInterface({ input, output });
    try {
      const project = detectProject(cwd);
      if (!project) {
        console.error('Could not detect a project at:', cwd);
        process.exit(1);
      }

      loadProjectEnv(project.root);
      printBanner(project.root);

      const experience = await readExperience(rl, options);
      if (experience === 'team-deploy') {
        await runTeamDeployWizard(rl, options);
        return;
      }

      const mode = experience === 'team-client' ? 'team' : 'local';
      const tool = await readTool(rl, options);
      const vaultPath = mode === 'local' ? normalizeOptionalPath(await readOptionalVaultPath(rl, options)) : undefined;
      const resolvedVaultPath = vaultPath ? path.resolve(vaultPath) : undefined;
      const teamServerUrl = mode === 'team' ? await readValue(rl, options.teamServerUrl, 'Team Server URL') : undefined;
      const teamApiKey = mode === 'team' ? await readValue(rl, options.teamApiKey, 'Team API key') : undefined;

      const plan = buildSetupPlan({
        mode,
        projectRoot: project.root,
        tool,
        vaultPath,
        teamServerUrl,
        teamApiKey,
      });

      console.log('\nSetup plan:');
      console.log(`  Mode:    ${mode === 'team' ? 'Team client' : 'Local personal'}`);
      console.log(`  Project: ${project.name}`);
      console.log(`  Data:    ${plan.dataDir}`);
      console.log(`  Tool:    ${tool}`);
      if (resolvedVaultPath) console.log(`  Vault:   ${resolvedVaultPath}`);
      if (teamServerUrl) console.log(`  Team:    ${teamServerUrl}`);

      if (!options.yes && !(await confirm(rl, 'Apply this setup?'))) {
        console.log('Setup cancelled.');
        return;
      }

      const configPath = writeProjectCliConfig(project.root, {
        mode,
        tool,
        vaultPath: resolvedVaultPath,
        teamServerUrl,
      });

      if (mode === 'local') {
        console.log('\nApplying local setup:');
        await initializeLocalProject(project, plan.dataDir, {
          vaultPath: resolvedVaultPath,
          onProgress: printStepProgress(7),
        });
      }

      const mcp = writeMcpConfig({
        tool,
        cwd: project.root,
        extraEnv: plan.environment,
      });

      if (resolvedVaultPath && mode === 'local') {
        await exportVaultDuringSetup(plan.dataDir, resolvedVaultPath, printStepProgress(2, 'Vault export'));
      }

      console.log('\nMindstrate ready:');
      console.log(`  Config:  ${configPath}`);
      console.log(`  MCP:     ${mcp.generated.join(', ')}`);
      console.log(`  Server:  ${mcp.serverPath}`);
      if (mode === 'local') {
        console.log('\nNext: configure LLM/embedding providers per-project in the web UI');
        console.log('  at /settings/llm-configs (admin only).');
      }
      if (mode === 'team' && (!teamServerUrl || !teamApiKey)) {
        console.log('\nTeam server next step:');
        console.log('  Deploy Team Server first, then re-run:');
        console.log('  mindstrate setup --mode team --team-server-url http://<server>:3388 --team-api-key <key>');
      }
    } catch (error) {
      console.error('Setup failed:', errorMessage(error));
      process.exit(1);
    } finally {
      rl.close();
    }
  });
