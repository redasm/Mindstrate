import * as readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { Command } from 'commander';
import {
  Mindstrate,
  detectProject,
  loadProjectMeta,
  saveProjectMeta,
  dependencyFingerprint,
  metaPath,
} from '@mindstrate/server';
import { SyncManager, VaultLayout } from '@mindstrate/obsidian-sync';
import { buildSetupPlan, writeProjectCliConfig, type SetupMode, type SetupTool } from '../cli-config.js';
import { askOptional, chooseOption } from '../cli-wizard.js';
import { errorMessage } from '../helpers.js';
import { writeMcpConfig } from './setup-mcp.js';

type SetupExperience = 'local' | 'team-client' | 'team-deploy';

interface SetupOptions {
  mode?: SetupMode | 'team-client' | 'team-deploy';
  tool?: SetupTool;
  vault?: string;
  teamServerUrl?: string;
  teamApiKey?: string;
  openaiApiKey?: string;
  openaiBaseUrl?: string;
  llmModel?: string;
  embeddingModel?: string;
  yes?: boolean;
}

export const setupCommand = new Command('setup')
  .description('Step-by-step setup wizard for local personal use or team deployment')
  .option('--mode <mode>', 'Setup mode: local, team-client, team-deploy, or team')
  .option('--tool <tool>', 'AI tool: opencode, cursor, claude-desktop, all')
  .option('--vault <path>', 'Obsidian vault path for local personal setup')
  .option('--team-server-url <url>', 'Team Server URL for team mode')
  .option('--team-api-key <key>', 'Team API key for team mode')
  .option('--openai-api-key <key>', 'LLM API key to inject into generated MCP config')
  .option('--openai-base-url <url>', 'OpenAI-compatible base URL')
  .option('--llm-model <model>', 'Chat/completion model')
  .option('--embedding-model <model>', 'Embedding model')
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

      printBanner(project.root);

      const experience = await readExperience(rl, options);
      if (experience === 'team-deploy') {
        await runTeamDeployWizard(rl, options);
        return;
      }

      const mode: SetupMode = experience === 'team-client' ? 'team' : 'local';
      const tool = await readTool(rl, options);
      const vaultPath = mode === 'local' ? await readOptionalVaultPath(rl, options) : undefined;
      const teamServerUrl = mode === 'team' ? await readValue(rl, options.teamServerUrl, 'Team Server URL') : undefined;
      const teamApiKey = mode === 'team' ? await readValue(rl, options.teamApiKey, 'Team API key') : undefined;
      const llmEnv = await readLlmEnvironment(rl, options);

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
      if (vaultPath) console.log(`  Vault:   ${path.resolve(vaultPath)}`);
      if (teamServerUrl) console.log(`  Team:    ${teamServerUrl}`);

      if (!options.yes && !(await confirm(rl, 'Apply this setup?'))) {
        console.log('Setup cancelled.');
        return;
      }

      const configPath = writeProjectCliConfig(project.root, {
        mode,
        tool,
        vaultPath: vaultPath ? path.resolve(vaultPath) : undefined,
        teamServerUrl,
      });

      if (mode === 'local') {
        await initializeLocalProject(project, plan.dataDir);
      }

      const mcp = writeMcpConfig({
        tool,
        cwd: project.root,
        extraEnv: {
          ...plan.environment,
          ...llmEnv,
        },
      });

      if (vaultPath && mode === 'local') {
        await exportVault(plan.dataDir, vaultPath);
      }

      console.log('\nMindstrate ready:');
      console.log(`  Config:  ${configPath}`);
      console.log(`  MCP:     ${mcp.generated.join(', ')}`);
      console.log(`  Server:  ${mcp.serverPath}`);
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

async function initializeLocalProject(project: NonNullable<ReturnType<typeof detectProject>>, dataDir: string): Promise<void> {
  const memory = new Mindstrate({ dataDir });
  await memory.init();
  const previousMeta = loadProjectMeta(project.root);
  const now = new Date().toISOString();
  const result = await memory.snapshots.upsertProjectSnapshot(project, { author: 'mindstrate-setup' });
  saveProjectMeta(project.root, {
    version: 1,
    name: project.name,
    rootHint: project.root,
    language: project.language,
    framework: project.framework,
    snapshotKnowledgeId: result.view.id,
    createdAt: previousMeta?.createdAt ?? now,
    updatedAt: now,
    fingerprint: dependencyFingerprint({
      language: project.language,
      framework: project.framework,
      dependencies: project.dependencies,
    }),
  });
  console.log(`  Project snapshot: ${result.changed ? 'updated' : 'up-to-date'} (${result.view.id})`);
  console.log(`  Meta: ${metaPath(project.root)}`);
  memory.close();
}

async function exportVault(dataDir: string, vaultPath: string): Promise<void> {
  const root = path.resolve(vaultPath);
  const layout = new VaultLayout({ vaultRoot: root });
  layout.ensureRoot();
  const memory = new Mindstrate({ dataDir });
  await memory.init();
  const sync = new SyncManager(memory, { vaultRoot: root });
  const result = await sync.exportAll();
  console.log(`  Vault export: ${result.written} written, ${result.skipped} skipped`);
  memory.close();
}

function printBanner(workspace: string): void {
  console.log('');
  console.log('Mindstrate Setup');
  console.log(`Workspace: ${workspace}`);
  console.log('');
}

async function readExperience(rl: readline.Interface, options: SetupOptions): Promise<SetupExperience> {
  if (options.mode === 'local') return 'local';
  if (options.mode === 'team' || options.mode === 'team-client') return 'team-client';
  if (options.mode === 'team-deploy') return 'team-deploy';
  if (options.yes) return 'local';
  return chooseOption(rl, 'What do you want to set up?', [
    {
      label: 'Local personal use',
      value: 'local',
      description: 'SQLite data in this project, optional Obsidian vault',
    },
    {
      label: 'Team member client',
      value: 'team-client',
      description: 'Connect this AI IDE to an existing Team Server',
    },
    {
      label: 'Team server deployment',
      value: 'team-deploy',
      description: 'Prepare deploy/.env.deploy for Docker deployment',
    },
  ], 0);
}

async function readTool(rl: readline.Interface, options: SetupOptions): Promise<SetupTool> {
  const valid = new Set(['opencode', 'cursor', 'claude-desktop', 'all']);
  if (options.tool && valid.has(options.tool)) return options.tool;
  if (options.yes) return 'opencode';
  return chooseOption(rl, 'Which AI tool should Mindstrate configure?', [
    { label: 'OpenCode', value: 'opencode', description: 'Project opencode.json' },
    { label: 'Cursor', value: 'cursor', description: 'Project .cursor/mcp.json' },
    { label: 'Claude Desktop', value: 'claude-desktop', description: 'Claude MCP config' },
    { label: 'All supported tools', value: 'all', description: 'Write every supported config' },
  ], 0);
}

async function readOptionalVaultPath(rl: readline.Interface, options: SetupOptions): Promise<string | undefined> {
  if (options.vault) return options.vault;
  if (options.yes) return undefined;
  const useVault = await chooseOption(rl, 'Connect an Obsidian vault?', [
    { label: 'Skip for now', value: 'no', description: 'You can add it later with vault sync' },
    { label: 'Yes, choose a vault path', value: 'yes', description: 'Export project knowledge as Markdown' },
  ], 0);
  if (useVault === 'no') return undefined;
  return askOptional(rl, 'Vault path');
}

async function readValue(rl: readline.Interface, current: string | undefined, label: string): Promise<string | undefined> {
  if (current) return current;
  const answer = await rl.question(`${label}? Leave empty to fill later: `);
  return answer.trim() || undefined;
}

async function readLlmEnvironment(rl: readline.Interface, options: SetupOptions): Promise<Record<string, string>> {
  const env: Record<string, string> = {};
  if (options.openaiApiKey) env.OPENAI_API_KEY = options.openaiApiKey;
  if (options.openaiBaseUrl) env.OPENAI_BASE_URL = options.openaiBaseUrl;
  if (options.llmModel) env.MINDSTRATE_LLM_MODEL = options.llmModel;
  if (options.embeddingModel) env.MINDSTRATE_EMBEDDING_MODEL = options.embeddingModel;
  if (options.yes || Object.keys(env).length > 0) return env;

  const provider = await chooseOption(rl, 'Configure LLM now?', [
    { label: 'Skip', value: 'skip', description: 'Use local hash embeddings and rule-based extraction' },
    { label: 'OpenAI-compatible API', value: 'openai', description: 'OpenAI, DashScope, Moonshot, local Ollama/vLLM' },
  ], 0);
  if (provider === 'skip') return env;
  const apiKey = await rl.question('OPENAI_API_KEY: ');
  const baseUrl = await rl.question('OPENAI_BASE_URL [https://api.openai.com/v1]: ');
  const llmModel = await rl.question('MINDSTRATE_LLM_MODEL [gpt-4o-mini]: ');
  const embeddingModel = await rl.question('MINDSTRATE_EMBEDDING_MODEL [text-embedding-3-small]: ');
  if (apiKey.trim()) env.OPENAI_API_KEY = apiKey.trim();
  env.OPENAI_BASE_URL = baseUrl.trim() || 'https://api.openai.com/v1';
  env.MINDSTRATE_LLM_MODEL = llmModel.trim() || 'gpt-4o-mini';
  env.MINDSTRATE_EMBEDDING_MODEL = embeddingModel.trim() || 'text-embedding-3-small';
  return env;
}

async function runTeamDeployWizard(rl: readline.Interface, options: SetupOptions): Promise<void> {
  console.log('\nTeam server deployment');
  const apiKey = options.teamApiKey
    ?? await askOptional(rl, 'TEAM_API_KEY for the server');
  const teamPort = await askOptional(rl, 'Team Server port [3388]') ?? '3388';
  const webPort = await askOptional(rl, 'Web UI port [3377]') ?? '3377';
  const openaiApiKey = options.openaiApiKey ?? await askOptional(rl, 'OPENAI_API_KEY for the server, leave empty for offline mode');
  const openaiBaseUrl = options.openaiBaseUrl ?? await askOptional(rl, 'OPENAI_BASE_URL, leave empty for OpenAI default');

  console.log('\nDeployment plan:');
  console.log('  Mode:    Team server deployment');
  console.log('  Compose: deploy/docker-compose.deploy.yml');
  console.log(`  API key: ${apiKey ? 'provided' : 'missing'}`);
  console.log(`  Team:    :${teamPort}`);
  console.log(`  Web UI:  :${webPort}`);

  if (!apiKey) {
    console.log('\nTEAM_API_KEY is required before Docker deployment can start.');
    return;
  }

  if (!options.yes && !(await confirm(rl, 'Write deployment config'))) {
    console.log('Deployment setup cancelled.');
    return;
  }

  const deployDir = path.resolve('deploy');
  if (!fs.existsSync(path.join(deployDir, 'docker-compose.deploy.yml'))) {
    console.log('\nCannot find deploy/docker-compose.deploy.yml in this workspace.');
    console.log('Run this deployment setup from the Mindstrate repository root.');
    return;
  }

  const envPath = path.join(deployDir, '.env.deploy');
  const lines = [
    'TEAM_API_KEY=' + apiKey,
    'TEAM_PORT=' + teamPort,
    'WEB_UI_PORT=' + webPort,
    'TEAM_BIND=0.0.0.0',
    'WEB_UI_BIND=0.0.0.0',
    'OPENAI_API_KEY=' + (openaiApiKey ?? ''),
    ...(openaiBaseUrl ? ['OPENAI_BASE_URL=' + openaiBaseUrl] : []),
    'EMBEDDING_MODEL=' + (options.embeddingModel ?? 'text-embedding-3-small'),
    'LLM_MODEL=' + (options.llmModel ?? 'gpt-4o-mini'),
    'LOG_LEVEL=info',
    'WEB_UI_LOCALE=zh',
    '',
  ];
  fs.writeFileSync(envPath, lines.join('\n'), 'utf8');

  console.log('\nTeam deployment config ready:');
  console.log(`  Env:     ${envPath}`);
  console.log('  Health:  http://<server>:' + teamPort + '/health');
  console.log('  Web UI:  http://<server>:' + webPort);
}

async function confirm(rl: readline.Interface, prompt: string): Promise<boolean> {
  const answer = await rl.question(`${prompt} Y/n: `);
  return answer.trim().toLowerCase() !== 'n';
}
