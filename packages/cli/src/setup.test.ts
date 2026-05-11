import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { detectProject, Mindstrate } from '@mindstrate/server';
import { initializeLocalProject, applySetupLlmEnvironment, setupMindstrateConfig } from './commands/setup.js';

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

  const memory = new Mindstrate({ dataDir });
  await memory.init();
  try {
    const results = memory.context.queryGraphKnowledge('before-edit generated output validation', {
      project: 'setup-graph-demo',
      topK: 10,
    });
    // The system-page internalizer creates RULE nodes with
    // `sourceRef = "system-page:<page-key>"`. At least one of the canonical
    // 8 architecture pages must be recallable through graph knowledge
    // search after the projection write.
    assert.ok(results.some((result) => result.view.sourceRef?.startsWith('system-page:')));
  } finally {
    memory.close();
  }
});

test('initializeLocalProject writes local project graph artifacts when vault is skipped', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mindstrate-cli-setup-local-'));
  const dataDir = path.join(root, '.mindstrate');
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({
    name: 'setup-local-graph-demo',
  }), 'utf8');

  const project = detectProject(root);
  assert.ok(project);

  await initializeLocalProject(project, dataDir, { vaultPath: '   ' });

  assert.equal(fs.existsSync(path.join(root, 'PROJECT_GRAPH.md')), true);
  assert.equal(fs.existsSync(path.join(root, '.mindstrate', 'project-graph.json')), true);
  assert.equal(fs.existsSync(path.join(root, '.mindstrate', 'project-graph.graph.json')), true);
  assert.equal(fs.existsSync(path.join(root, 'setup-local-graph-demo', 'architecture', 'project-graph.md')), false);
});

test('initializeLocalProject reports progress for long setup steps', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mindstrate-cli-setup-progress-'));
  const dataDir = path.join(root, '.mindstrate');
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({
    name: 'setup-progress-demo',
  }), 'utf8');

  const project = detectProject(root);
  assert.ok(project);
  const steps: string[] = [];

  await initializeLocalProject(project, dataDir, {
    onProgress: (message) => steps.push(message),
  });

  assert.deepEqual(steps, [
    'Opening local memory database',
    'Writing project snapshot',
    'Scanning project graph scope',
    'Indexing project graph',
    'Running optional LLM enrichment',
    'Writing project graph artifacts',
    'Saving project metadata',
  ]);
});

test('setupMindstrateConfig applies LLM values collected during setup', () => {
  assert.deepEqual(setupMindstrateConfig('data', {
    OPENAI_API_KEY: 'key',
    OPENAI_BASE_URL: 'https://llm.example/v1',
    MINDSTRATE_LLM_MODEL: 'chat-model',
    MINDSTRATE_EMBEDDING_MODEL: 'embedding-model',
  }), {
    dataDir: 'data',
    openaiApiKey: 'key',
    openaiBaseUrl: 'https://llm.example/v1',
    llmModel: 'chat-model',
    embeddingModel: 'embedding-model',
  });
});

test('applySetupLlmEnvironment writes project env and updates current process', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mindstrate-cli-setup-env-'));
  const previousApiKey = process.env['OPENAI_API_KEY'];
  const previousBaseUrl = process.env['OPENAI_BASE_URL'];
  fs.writeFileSync(path.join(root, '.env'), 'CUSTOM_VALUE=kept\nOPENAI_API_KEY=old\n', 'utf8');

  try {
    const envPath = applySetupLlmEnvironment(root, {
      OPENAI_API_KEY: 'new-key',
      OPENAI_BASE_URL: 'https://llm.example/v1',
    });

    assert.equal(envPath, path.join(root, '.env'));
    assert.equal(process.env['OPENAI_API_KEY'], 'new-key');
    assert.equal(process.env['OPENAI_BASE_URL'], 'https://llm.example/v1');
    assert.equal(fs.readFileSync(path.join(root, '.env'), 'utf8'), [
      'CUSTOM_VALUE=kept',
      'OPENAI_API_KEY=new-key',
      '',
      'OPENAI_BASE_URL=https://llm.example/v1',
      '',
    ].join('\n'));
  } finally {
    restoreEnv('OPENAI_API_KEY', previousApiKey);
    restoreEnv('OPENAI_BASE_URL', previousBaseUrl);
  }
});

test('applySetupLlmEnvironment returns null and does not write when llmEnv is empty', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mindstrate-cli-setup-env-empty-'));
  const envPath = path.join(root, '.env');

  const result = applySetupLlmEnvironment(root, {});

  assert.equal(result, null);
  assert.equal(fs.existsSync(envPath), false);
});

function restoreEnv(key: string, value: string | undefined): void {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}
