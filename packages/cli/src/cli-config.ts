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

const CONFIG_DIR = '.mindstrate';
const CONFIG_FILE = 'config.json';

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
