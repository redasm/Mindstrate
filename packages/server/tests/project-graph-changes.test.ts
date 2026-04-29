import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  ChangeSource,
  ContextDomainType,
  ContextNodeStatus,
  ProjectGraphNodeKind,
  ProjectGraphProvenance,
  SubstrateType,
} from '@mindstrate/protocol/models';
import { Mindstrate, detectProject } from '../src/index.js';
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

    const result = memory.context.detectProjectGraphChanges(project, {
      source: ChangeSource.MANUAL,
      files: ['Source/Client/Client.Build.cs', 'Intermediate/generated.txt'],
    });

    expect(result.changeSet.source).toBe(ChangeSource.MANUAL);
    expect(result.affectedNodeIds.length).toBeGreaterThan(0);
    expect(result.affectedLayers).toEqual(expect.arrayContaining(['gameplay-cpp', 'generated']));
    expect(result.riskHints).toContain('Do not edit generated Unreal output unless explicitly requested.');
  });

  it('preserves external collector changeset metadata while mapping affected graph context', () => {
    write(root, 'Client.uproject', JSON.stringify({ FileVersion: 3 }));
    fs.mkdirSync(path.join(root, 'Content'));
    fs.mkdirSync(path.join(root, 'Config'));
    write(root, 'Source/Client/Client.Build.cs', 'public class Client {}');

    const project = detectProject(root)!;
    memory.context.indexProjectGraph(project);

    const result = memory.context.ingestProjectGraphChangeSet(project, {
      source: ChangeSource.P4,
      base: '123',
      head: '124',
      files: [
        {
          path: 'Source\\Client\\Client.Build.cs',
          oldPath: 'Source\\OldClient\\Client.Build.cs',
          status: 'renamed',
          language: 'csharp',
          layerId: 'custom-gameplay',
        },
      ],
    });

    expect(result.changeSet).toEqual({
      source: ChangeSource.P4,
      base: '123',
      head: '124',
      files: [
        {
          path: 'Source/Client/Client.Build.cs',
          oldPath: 'Source/OldClient/Client.Build.cs',
          status: 'renamed',
          language: 'csharp',
          layerId: 'custom-gameplay',
        },
      ],
    });
    expect(result.affectedNodeIds.length).toBeGreaterThan(0);
    expect(result.affectedLayers).toEqual(['custom-gameplay']);
  });

  it('matches normalized changed files against graph nodes written with platform separators', () => {
    write(root, 'package.json', JSON.stringify({ scripts: { build: 'tsc' } }));
    const project = detectProject(root)!;
    memory.context.createContextNode({
      id: 'pg:demo:file:windows',
      substrateType: SubstrateType.SNAPSHOT,
      domainType: ContextDomainType.ARCHITECTURE,
      title: 'src\\App.tsx',
      content: 'file: src\\App.tsx',
      project: project.name,
      status: ContextNodeStatus.ACTIVE,
      metadata: {
        projectGraph: true,
        kind: ProjectGraphNodeKind.FILE,
        provenance: ProjectGraphProvenance.EXTRACTED,
        ownedByFile: 'src\\App.tsx',
      },
    });

    const result = memory.context.ingestProjectGraphChangeSet(project, {
      source: ChangeSource.MANUAL,
      files: [{ path: 'src/App.tsx', status: 'modified' }],
    });

    expect(result.affectedNodeIds).toContain('pg:demo:file:windows');
  });
});
