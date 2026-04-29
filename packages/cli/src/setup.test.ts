import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { detectProject } from '@mindstrate/server';
import { initializeLocalProject } from './commands/setup.js';

test('initializeLocalProject indexes the project graph for local setup', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mindstrate-cli-setup-'));
  const dataDir = path.join(root, '.mindstrate');
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

  await initializeLocalProject(project, dataDir);

  assert.equal(fs.existsSync(path.join(root, 'PROJECT_GRAPH.md')), true);
  assert.equal(fs.existsSync(path.join(root, '.mindstrate', 'project-graph.json')), true);
});
