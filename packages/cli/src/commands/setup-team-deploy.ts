/**
 * `mindstrate setup --mode team-deploy` wizard.
 *
 * Deploy targets are pure file/text writers (deploy/.env.deploy) and do
 * not touch the in-process Mindstrate instance, so this lives in its own
 * module and is invoked by `setup.ts` only when the chosen experience is
 * `team-deploy`.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as readline from 'node:readline/promises';
import { askOptional } from '../cli-wizard.js';
import { confirm, type SetupOptions } from './setup-prompts.js';

export async function runTeamDeployWizard(
  rl: readline.Interface,
  options: SetupOptions,
): Promise<void> {
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
