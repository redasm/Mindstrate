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
    expect(result.changeTypes).toEqual(expect.arrayContaining(['build-module', 'generated-output']));
    expect(result.doNotEdit).toEqual(expect.arrayContaining(['Intermediate']));
    expect(result.riskHints).toContain('Do not edit generated Unreal output unless explicitly requested.');
    expect(result.riskHints).toContain('Generated output changed; identify the source of truth before editing or committing.');
    expect(result.requiredSearches).toEqual(expect.arrayContaining([
      'direct callers/importers of changed files',
      'source files or generator inputs that produce changed generated declarations',
      '.uproject, .uplugin, and Build.cs dependency consistency',
    ]));
    expect(result.recommendedValidation).toEqual(expect.arrayContaining([
      'Unreal build compile for the affected target.',
      'Run type generation or TypeScript validation for affected generated declarations/consumers.',
    ]));
  });

  it('classifies Unreal manifest, config, asset, editor, cpp, and TypeScript changes', () => {
    write(root, 'Client.uproject', JSON.stringify({ FileVersion: 3 }));
    fs.mkdirSync(path.join(root, 'Content'));
    fs.mkdirSync(path.join(root, 'Config'));

    const project = detectProject(root)!;
    const result = memory.context.ingestProjectGraphChangeSet(project, {
      source: ChangeSource.MANUAL,
      files: [
        { path: 'Client.uproject', status: 'modified' },
        { path: 'Plugins/Inventory/Inventory.uplugin', status: 'modified' },
        { path: 'Config/DefaultEngine.ini', status: 'modified' },
        { path: 'Content/UI/HUD.uasset', status: 'modified' },
        { path: 'Source/Client/Private/ClientGame.cpp', status: 'modified' },
        { path: 'Source/ClientEditor/Private/ClientEditor.cpp', status: 'modified' },
        { path: 'TypeScript/app.ts', status: 'modified' },
      ],
    });

    expect(result.changeTypes).toEqual(expect.arrayContaining([
      'project-manifest',
      'plugin-manifest',
      'config-sensitive',
      'asset-reference-sensitive',
      'cpp-source',
      'editor-boundary',
      'typescript-consumer',
    ]));
    expect(result.riskHints).toEqual(expect.arrayContaining([
      'Manifest changes can alter enabled plugins, module load phase, and startup behavior.',
      'Check that Runtime modules do not depend on editor-only modules.',
      'Content asset paths may be soft-referenced; avoid plain filesystem rename.',
    ]));
    expect(result.requiredSearches).toEqual(expect.arrayContaining([
      '.uproject, .uplugin, and Build.cs dependency consistency',
      'Runtime versus Editor module dependency direction',
      'classes, modules, or plugins referenced from config',
      'Asset Registry soft/hard references',
    ]));
    expect(result.recommendedValidation).toEqual(expect.arrayContaining([
      'Unreal build compile for the affected target.',
      'Validate plugin dependency consistency and editor/runtime startup.',
      'Validate config load for the affected target.',
      'Run Unreal-aware asset reference validation.',
      'Run type generation or TypeScript validation for affected generated declarations/consumers.',
    ]));
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
