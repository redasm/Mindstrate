import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { detectProject } from '@mindstrate/server';
import { initializeLocalProject } from './commands/setup.js';

test('initializeLocalProject writes the project graph to Obsidian when a vault is configured', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mindstrate-cli-setup-'));
  const dataDir = path.join(root, '.mindstrate');
  const vaultDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mindstrate-cli-vault-'));
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({
    name: 'setup-graph-demo',
    dependencies: { react: '^19.0.0' },
  }), 'utf8');
  fs.mkdirSync(path.join(root, 'src'));
  fs.writeFileSync(path.join(root, 'src', 'App.tsx'), [
    'import React from "react";',
    'export function App() { return <main />; }',
  ].join('\n'), 'utf8');

  const project = detectProject(root);
  assert.ok(project);

  await initializeLocalProject(project, dataDir, { vaultPath: vaultDir });

  assert.equal(fs.existsSync(path.join(vaultDir, 'setup-graph-demo', 'architecture', 'project-graph.md')), true);
  assert.equal(fs.existsSync(path.join(root, '.mindstrate', 'project-graph.json')), true);
});
