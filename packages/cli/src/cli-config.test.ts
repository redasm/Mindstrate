import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  buildSetupPlan,
  loadProjectEnv,
  projectEnvPath,
  resolveProjectDataDir,
  upsertProjectEnv,
  writeProjectCliConfig,
} from './cli-config.js';

test('resolveProjectDataDir prefers the current project .mindstrate directory', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mindstrate-cli-'));
  fs.mkdirSync(path.join(root, '.mindstrate'));

  assert.equal(resolveProjectDataDir(root), path.join(root, '.mindstrate'));
});

test('writeProjectCliConfig persists vault and tool choices for later commands', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mindstrate-cli-'));
  const written = writeProjectCliConfig(root, {
    mode: 'local',
    tool: 'opencode',
    vaultPath: 'D:\\MindstrateVault',
  });

  assert.equal(written, path.join(root, '.mindstrate', 'config.json'));
  assert.deepEqual(JSON.parse(fs.readFileSync(written, 'utf8')), {
    version: 1,
    mode: 'local',
    dataDir: '.mindstrate',
    tool: 'opencode',
    vaultPath: 'D:\\MindstrateVault',
  });
});

test('buildSetupPlan separates local personal setup from team setup', () => {
  const local = buildSetupPlan({
    mode: 'local',
    projectRoot: 'D:\\Project',
    tool: 'opencode',
    vaultPath: 'D:\\Vault',
  });
  assert.deepEqual(local.steps, ['init-local', 'write-tool-config', 'connect-vault']);
  assert.equal(local.requiresTeamServer, false);

  const team = buildSetupPlan({
    mode: 'team',
    projectRoot: 'D:\\Project',
    tool: 'cursor',
    teamServerUrl: 'http://server:3388',
    teamApiKey: 'secret',
  });
  assert.deepEqual(team.steps, ['init-team-client', 'write-tool-config']);
  assert.equal(team.requiresTeamServer, true);
  assert.equal(team.environment.TEAM_SERVER_URL, 'http://server:3388');
  assert.equal(team.environment.TEAM_API_KEY, 'secret');
});

test('loadProjectEnv loads project env without overriding shell env', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mindstrate-cli-env-'));
  const previousApiKey = process.env['OPENAI_API_KEY'];
  const previousModel = process.env['MINDSTRATE_LLM_MODEL'];
  process.env['OPENAI_API_KEY'] = 'shell-key';
  delete process.env['MINDSTRATE_LLM_MODEL'];
  fs.writeFileSync(projectEnvPath(root), [
    'OPENAI_API_KEY=file-key',
    'MINDSTRATE_LLM_MODEL="qwen-max" # inline comment',
    '',
  ].join('\n'), 'utf8');

  try {
    const result = loadProjectEnv(root);

    assert.deepEqual(result?.loaded, ['MINDSTRATE_LLM_MODEL']);
    assert.deepEqual(result?.skipped, ['OPENAI_API_KEY']);
    assert.equal(process.env['OPENAI_API_KEY'], 'shell-key');
    assert.equal(process.env['MINDSTRATE_LLM_MODEL'], 'qwen-max');
  } finally {
    restoreEnv('OPENAI_API_KEY', previousApiKey);
    restoreEnv('MINDSTRATE_LLM_MODEL', previousModel);
  }
});

test('upsertProjectEnv merges LLM values without dropping existing content', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mindstrate-cli-env-'));
  fs.writeFileSync(projectEnvPath(root), [
    '# existing config',
    'OPENAI_API_KEY=old-key',
    'CUSTOM_VALUE=kept',
    '',
  ].join('\n'), 'utf8');

  const envPath = upsertProjectEnv(root, {
    OPENAI_API_KEY: 'new key',
    OPENAI_BASE_URL: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    MINDSTRATE_LLM_MODEL: undefined,
  });

  assert.equal(envPath, projectEnvPath(root));
  assert.equal(fs.readFileSync(envPath, 'utf8'), [
    '# existing config',
    'OPENAI_API_KEY="new key"',
    'CUSTOM_VALUE=kept',
    '',
    'OPENAI_BASE_URL=https://dashscope.aliyuncs.com/compatible-mode/v1',
    '',
  ].join('\n'));
});

function restoreEnv(key: string, value: string | undefined): void {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}
