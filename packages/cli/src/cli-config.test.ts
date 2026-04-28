import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  buildSetupPlan,
  resolveProjectDataDir,
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
