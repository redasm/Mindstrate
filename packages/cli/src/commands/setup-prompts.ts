/**
 * Interactive prompts and small input helpers for `mindstrate setup`.
 *
 * Pulled out so `setup.ts` can stay a thin command-action file. The
 * functions here are purely conversational — they read stdin and write to
 * stdout, never touching the data directory or `process.env`.
 */

import * as readline from 'node:readline/promises';
import { askOptional, chooseOption } from '../cli-wizard.js';
import type { SetupMode, SetupTool } from '../cli-config.js';

export type SetupExperience = 'local' | 'team-client' | 'team-deploy';

export interface SetupOptions {
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

export const printBanner = (workspace: string): void => {
  console.log('');
  console.log('Mindstrate Setup');
  console.log(`Workspace: ${workspace}`);
  console.log('');
};

export const normalizeOptionalPath = (value: string | undefined): string | undefined => {
  const trimmed = value?.trim();
  return trimmed || undefined;
};

export const confirm = async (rl: readline.Interface, prompt: string): Promise<boolean> => {
  const answer = await rl.question(`${prompt} Y/n: `);
  return answer.trim().toLowerCase() !== 'n';
};

export const readExperience = async (
  rl: readline.Interface,
  options: SetupOptions,
): Promise<SetupExperience> => {
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
};

export const readTool = async (
  rl: readline.Interface,
  options: SetupOptions,
): Promise<SetupTool> => {
  const valid = new Set(['opencode', 'cursor', 'claude-desktop', 'all']);
  if (options.tool && valid.has(options.tool)) return options.tool;
  if (options.yes) return 'opencode';
  return chooseOption(rl, 'Which AI tool should Mindstrate configure?', [
    { label: 'OpenCode', value: 'opencode', description: 'Project opencode.json' },
    { label: 'Cursor', value: 'cursor', description: 'Project .cursor/mcp.json' },
    { label: 'Claude Desktop', value: 'claude-desktop', description: 'Claude MCP config' },
    { label: 'All supported tools', value: 'all', description: 'Write every supported config' },
  ], 0);
};

export const readOptionalVaultPath = async (
  rl: readline.Interface,
  options: SetupOptions,
): Promise<string | undefined> => {
  if (options.vault) return normalizeOptionalPath(options.vault);
  if (options.yes) return undefined;
  const useVault = await chooseOption(rl, 'Connect an Obsidian vault?', [
    { label: 'Skip for now', value: 'no', description: 'You can add it later with vault sync' },
    { label: 'Yes, choose a vault path', value: 'yes', description: 'Export project knowledge as Markdown' },
  ], 0);
  if (useVault === 'no') return undefined;
  return askOptional(rl, 'Vault path');
};

export const readValue = async (
  rl: readline.Interface,
  current: string | undefined,
  label: string,
): Promise<string | undefined> => {
  if (current) return current;
  const answer = await rl.question(`${label}? Leave empty to fill later: `);
  return answer.trim() || undefined;
};

export const readLlmEnvironment = async (
  rl: readline.Interface,
  options: SetupOptions,
): Promise<Record<string, string>> => {
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
};
