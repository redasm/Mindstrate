import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { Mindstrate, detectProject } from '@mindstrate/server';
import { writeLocalProjectGraphArtifacts } from './commands/init.js';

test('writeLocalProjectGraphArtifacts prefers Obsidian output when vault is configured', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mindstrate-cli-init-'));
  const vaultDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mindstrate-cli-init-vault-'));
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'init-graph-demo' }), 'utf8');
  fs.mkdirSync(path.join(root, 'src'));
  fs.writeFileSync(path.join(root, 'src', 'App.tsx'), 'export function App() { return <main />; }', 'utf8');

  const memory = new Mindstrate({ dataDir: path.join(root, '.mindstrate') });
  await memory.init();
  try {
    const project = detectProject(root);
    assert.ok(project);
    memory.context.indexProjectGraph(project);

    const result = writeLocalProjectGraphArtifacts(memory, project, vaultDir);

    assert.equal(result.reportPath, path.join(vaultDir, 'init-graph-demo', 'architecture', 'project-graph.md'));
    assert.equal(fs.existsSync(result.reportPath), true);
  } finally {
    memory.close();
  }
});
