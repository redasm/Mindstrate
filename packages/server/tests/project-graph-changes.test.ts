import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { ChangeSource } from '@mindstrate/protocol/models';
import { Mindstrate, detectProject } from '../src/index.js';
import { detectProjectGraphChanges } from '../src/project-graph/changes.js';
import { createTempDir, removeTempDir } from './test-support.js';

const write = (root: string, rel: string, content: string): void => {
  const abs = path.join(root, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content, 'utf8');
};

describe('project graph change detection', () => {
  let root: string;
  let dataDir: string;
  let memory: Mindstrate;

  beforeEach(async () => {
    root = createTempDir('mindstrate-project-graph-changes-');
    dataDir = createTempDir('mindstrate-project-graph-changes-data-');
    memory = new Mindstrate({ dataDir });
    await memory.init();
  });

  afterEach(() => {
    memory.close();
    removeTempDir(root);
    removeTempDir(dataDir);
  });

  it('maps manual changed files to nodes, layers, and risk hints', () => {
    write(root, 'Client.uproject', JSON.stringify({ FileVersion: 3 }));
    fs.mkdirSync(path.join(root, 'Content'));
    fs.mkdirSync(path.join(root, 'Config'));
    write(root, 'Source/Client/Client.Build.cs', 'public class Client {}');
    write(root, 'Intermediate/generated.txt', 'generated');

    const project = detectProject(root)!;
    memory.context.indexProjectGraph(project);

    const result = detectProjectGraphChanges(memory.context, project, {
      source: ChangeSource.MANUAL,
      files: ['Source/Client/Client.Build.cs', 'Intermediate/generated.txt'],
    });

    expect(result.changeSet.source).toBe(ChangeSource.MANUAL);
    expect(result.affectedNodeIds.length).toBeGreaterThan(0);
    expect(result.affectedLayers).toEqual(expect.arrayContaining(['gameplay-cpp', 'generated']));
    expect(result.riskHints).toContain('Do not edit generated Unreal output unless explicitly requested.');
  });
});
