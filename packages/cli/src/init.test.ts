import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { Mindstrate, detectProject } from '@mindstrate/server';
import {
  buildProjectGraphAnalysisLines,
  publishProjectGraphToTeamServer,
  writeLocalProjectGraphArtifacts,
} from './commands/init.js';

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

test('publishProjectGraphToTeamServer sends a project-scoped graph bundle', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mindstrate-cli-init-team-'));
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'team-graph-demo' }), 'utf8');
  fs.mkdirSync(path.join(root, 'src'));
  fs.writeFileSync(path.join(root, 'src', 'App.tsx'), 'export function App() { return <main />; }', 'utf8');
  const memory = new Mindstrate({ dataDir: path.join(root, '.mindstrate') });
  await memory.init();
  try {
    const project = detectProject(root);
    assert.ok(project);
    memory.context.indexProjectGraph(project);
    let published: unknown;

    const result = await publishProjectGraphToTeamServer(memory, project, {
      context: {
        publishProjectGraph: async (input: unknown) => {
          published = input;
          return { installedNodes: 1, updatedNodes: 0, installedEdges: 0, skippedEdges: 0 };
        },
      },
    });

    assert.equal(result.installedNodes, 1);
    assert.equal((published as any).repoId, 'team-graph-demo');
    assert.equal((published as any).bundle.projectScoped, true);
    assert.ok((published as any).bundle.nodes.length > 0);
  } finally {
    memory.close();
  }
});

test('buildProjectGraphAnalysisLines explains scan scope and LLM enrichment', () => {
  const lines = buildProjectGraphAnalysisLines({
    projectName: 'demo',
    filesToScan: 12,
    totalBytes: 1536,
    languages: { typescript: 8, markdown: 4 },
    ignoredDirectories: ['node_modules', 'dist'],
    generatedRoots: ['dist'],
    llmEnrichment: 'skipped',
  });

  assert.deepEqual(lines, [
    'Analyzing project graph:',
    '  Project: demo',
    '  Files to scan: 12',
    '  Estimated size: 1.5 KB',
    '  Languages: markdown 4, typescript 8',
    '  Ignored: dist, node_modules',
    '  LLM enrichment: skipped (deterministic parser/config extraction only)',
    '  Privacy: full source files are not sent to LLM providers by default',
  ]);
});
