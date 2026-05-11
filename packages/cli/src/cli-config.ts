import * as fs from 'node:fs';
import * as path from 'node:path';

export type SetupMode = 'local' | 'team';
export type SetupTool = 'cursor' | 'opencode' | 'claude-desktop' | 'all';

export interface ProjectCliConfig {
  version: 1;
  mode?: SetupMode;
  dataDir?: string;
  tool?: SetupTool;
  vaultPath?: string;
  teamServerUrl?: string;
}

export interface SetupPlanInput {
  mode: SetupMode;
  projectRoot: string;
  tool?: SetupTool;
  vaultPath?: string;
  teamServerUrl?: string;
  teamApiKey?: string;
}

export interface SetupPlan {
  mode: SetupMode;
  dataDir: string;
  steps: string[];
  requiresTeamServer: boolean;
  environment: Record<string, string>;
}

export interface ProjectEnvLoadResult {
  path: string;
  loaded: string[];
  skipped: string[];
}

const CONFIG_DIR = '.mindstrate';
const CONFIG_FILE = 'config.json';
const ENV_FILE = '.env';

export const projectEnvPath = (projectRoot: string): string =>
  path.join(projectRoot, ENV_FILE);

/**
 * 加载项目根目录下的 `.env` 到 `process.env`。
 *
 * 解析能力（故意保持最小）：
 * - 支持 `KEY=value`、`export KEY=value`；
 * - 支持双引号 / 单引号包裹值，但**不展开转义**（如 `\n` 不会被解释为换行）；
 * - 支持以 `#` 开头的整行注释，以及在未引用区域内出现的、前面是空白的 inline `#`；
 * - **不支持** 多行值、变量插值（`${VAR}`）、HEREDOC、复杂引号转义。
 *
 * 不会覆盖已经在 shell / process.env 中存在的 key（shell wins），返回 `loaded`
 * 与 `skipped` 列表方便上层日志或诊断。需要更复杂的语法时调用方应改用 `dotenv`。
 */
export const loadProjectEnv = (projectRoot: string): ProjectEnvLoadResult | null => {
  const envPath = projectEnvPath(projectRoot);
  if (!fs.existsSync(envPath)) return null;
  const parsed = parseEnvFile(fs.readFileSync(envPath, 'utf8'));
  const loaded: string[] = [];
  const skipped: string[] = [];
  for (const [key, value] of Object.entries(parsed)) {
    if (process.env[key] !== undefined) {
      skipped.push(key);
      continue;
    }
    process.env[key] = value;
    loaded.push(key);
  }
  return { path: envPath, loaded, skipped };
};

export const upsertProjectEnv = (projectRoot: string, values: Record<string, string | undefined>): string => {
  const envPath = projectEnvPath(projectRoot);
  const existing = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf8') : '';
  const next = mergeEnvContent(existing, values);
  fs.writeFileSync(envPath, next, 'utf8');
  return envPath;
};

export const projectCliConfigPath = (projectRoot: string): string =>
  path.join(projectRoot, CONFIG_DIR, CONFIG_FILE);

export const readProjectCliConfig = (projectRoot: string): ProjectCliConfig | null => {
  const configPath = projectCliConfigPath(projectRoot);
  if (!fs.existsSync(configPath)) return null;
  try {
    const parsed = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    return parsed && typeof parsed === 'object' ? parsed as ProjectCliConfig : null;
  } catch {
    return null;
  }
};

export const writeProjectCliConfig = (
  projectRoot: string,
  input: Omit<ProjectCliConfig, 'version' | 'dataDir'> & { dataDir?: string },
): string => {
  const configPath = projectCliConfigPath(projectRoot);
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  const config: ProjectCliConfig = {
    version: 1,
    ...input,
    dataDir: input.dataDir ?? CONFIG_DIR,
  };
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n', 'utf8');
  return configPath;
};

export const resolveProjectDataDir = (cwd: string, explicitDataDir?: string): string | undefined => {
  if (explicitDataDir) return path.resolve(explicitDataDir);

  const config = readProjectCliConfig(cwd);
  if (config?.dataDir) {
    return path.resolve(cwd, config.dataDir);
  }

  const localDataDir = path.join(cwd, CONFIG_DIR);
  return fs.existsSync(localDataDir) ? localDataDir : undefined;
};

export const buildSetupPlan = (input: SetupPlanInput): SetupPlan => {
  const dataDir = path.join(input.projectRoot, CONFIG_DIR);
  const steps = input.mode === 'team'
    ? ['init-team-client', 'write-tool-config']
    : ['init-local'];
  if (input.mode === 'local' && input.tool) steps.push('write-tool-config');
  if (input.mode === 'local' && input.vaultPath) steps.push('connect-vault');

  const environment: Record<string, string> = {
    MINDSTRATE_DATA_DIR: dataDir,
  };
  if (input.mode === 'team') {
    if (input.teamServerUrl) environment.TEAM_SERVER_URL = input.teamServerUrl;
    if (input.teamApiKey) environment.TEAM_API_KEY = input.teamApiKey;
  }

  return {
    mode: input.mode,
    dataDir,
    steps,
    requiresTeamServer: input.mode === 'team',
    environment,
  };
};

const parseEnvFile = (content: string): Record<string, string> => {
  const env: Record<string, string> = {};
  for (const line of content.split(/\r?\n/)) {
    const parsed = parseEnvLine(line);
    if (parsed) env[parsed.key] = parsed.value;
  }
  return env;
};

const parseEnvLine = (line: string): { key: string; value: string } | null => {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('#')) return null;
  const source = trimmed.startsWith('export ') ? trimmed.slice('export '.length).trimStart() : trimmed;
  const separator = source.indexOf('=');
  if (separator <= 0) return null;
  const key = source.slice(0, separator).trim();
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) return null;
  return { key, value: normalizeEnvValue(source.slice(separator + 1).trim()) };
};

const normalizeEnvValue = (value: string): string => {
  const commentStart = findInlineCommentStart(value);
  const raw = (commentStart >= 0 ? value.slice(0, commentStart) : value).trim();
  if (raw.length >= 2 && ((raw.startsWith('"') && raw.endsWith('"')) || (raw.startsWith("'") && raw.endsWith("'")))) {
    return raw.slice(1, -1);
  }
  return raw;
};

const findInlineCommentStart = (value: string): number => {
  let quote: 'single' | 'double' | null = null;
  for (let index = 0; index < value.length; index++) {
    const char = value[index];
    if (char === "'" && quote !== 'double') quote = quote === 'single' ? null : 'single';
    if (char === '"' && quote !== 'single') quote = quote === 'double' ? null : 'double';
    if (char === '#' && quote === null && (index === 0 || /\s/.test(value[index - 1] ?? ''))) return index;
  }
  return -1;
};

const mergeEnvContent = (content: string, values: Record<string, string | undefined>): string => {
  const pending = new Map(Object.entries(values).filter((entry): entry is [string, string] => typeof entry[1] === 'string' && entry[1].length > 0));
  const lines = content ? content.split(/\r?\n/) : [];
  const result = lines.map((line) => {
    const parsed = parseEnvLine(line);
    if (!parsed || !pending.has(parsed.key)) return line;
    const value = pending.get(parsed.key) ?? '';
    pending.delete(parsed.key);
    return `${parsed.key}=${formatEnvValue(value)}`;
  });
  if (pending.size > 0 && result.some((line) => line.trim().length > 0) && result[result.length - 1]?.trim()) result.push('');
  for (const [key, value] of pending) result.push(`${key}=${formatEnvValue(value)}`);
  while (result.length > 0 && result[result.length - 1] === '') result.pop();
  return result.join('\n') + '\n';
};

const formatEnvValue = (value: string): string => /^[A-Za-z0-9_./:@+-]*$/.test(value)
  ? value
  : JSON.stringify(value);
