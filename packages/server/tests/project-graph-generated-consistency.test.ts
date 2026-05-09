import * as fs from 'node:fs';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ContextGraphStore } from '../src/context-graph/context-graph-store.js';
import { detectProject } from '../src/project/detector.js';
import { checkGeneratedEditSafety } from '../src/project-graph/generated-consistency.js';
import { indexProjectGraph } from '../src/project-graph/project-graph-service.js';
import { createTempDir, removeTempDir } from './test-support.js';

const write = (root: string, rel: string, content: string): void => {
  const abs = path.join(root, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content, 'utf8');
};

describe('generated project graph consistency checks', () => {
  let root: string;
  let store: ContextGraphStore;

  beforeEach(() => {
    root = createTempDir('mindstrate-project-graph-generated-consistency-');
    store = new ContextGraphStore(path.join(root, '.mindstrate', 'context-graph.db'));
  });

  afterEach(() => {
    store.close();
    removeTempDir(root);
  });

  it('flags generated files and reports the graph source of truth when known', () => {
    materializeGeneratedBindingProject();

    const project = detectProject(root);
    expect(project).not.toBeNull();
    indexProjectGraph(store, project!);

    const issues = checkGeneratedEditSafety({
      changedFiles: ['TypeScript/Typing/InventoryComponent.ts', 'TypeScript/src/inventory.ts'],
      nodes: store.listNodes({ project: 'Client', limit: 200 }),
      edges: store.listEdges({ limit: 200 }),
      generatedRoots: project!.graphHints?.generatedRoots,
    });

    expect(issues).toEqual([
      expect.objectContaining({
        code: 'generated-file-edited',
        file: 'TypeScript/Typing/InventoryComponent.ts',
        sourceOfTruthLabel: 'InventoryComponent',
        sourceOfTruthFile: 'Source/Client/InventoryComponent.h',
      }),
    ]);
    expect(issues[0]?.message).toContain('Edit source of truth InventoryComponent');
  });

  it('flags generated roots even when no graph source is known yet', () => {
    write(root, 'Client.uproject', '{"FileVersion":3}');
    write(root, 'Config/DefaultGame.ini', '[/Script/EngineSettings.GeneralProjectSettings]');
    fs.mkdirSync(path.join(root, 'Content'), { recursive: true });
    fs.mkdirSync(path.join(root, 'Source'), { recursive: true });

    const project = detectProject(root);
    expect(project).not.toBeNull();
    const issues = checkGeneratedEditSafety({
      changedFiles: ['Intermediate/Build/generated.cpp'],
      nodes: [],
      edges: [],
      generatedRoots: project!.graphHints?.generatedRoots,
    });

    expect(issues).toEqual([
      expect.objectContaining({
        file: 'Intermediate/Build/generated.cpp',
        sourceOfTruthLabel: undefined,
      }),
    ]);
    expect(issues[0]?.message).toContain('Identify the upstream source of truth');
  });

  const materializeGeneratedBindingProject = (): void => {
    write(root, 'Client.uproject', '{"FileVersion":3}');
    fs.mkdirSync(path.join(root, 'Content'), { recursive: true });
    fs.mkdirSync(path.join(root, 'Config'), { recursive: true });
    write(root, '.mindstrate/rules/client-bindings.json', JSON.stringify({
      id: 'client-bindings',
      name: 'Client Bindings',
      priority: 200,
      match: { all: [{ glob: '*.uproject' }] },
      detect: { language: 'cpp', framework: 'unreal-engine', manifest: '*.uproject' },
      sourceRoots: ['Source', 'TypeScript/src', 'TypeScript/Typing'],
      generatedRoots: ['TypeScript/Typing'],
      layers: [],
      manifests: ['*.uproject'],
    }));
    write(root, 'Source/Client/InventoryComponent.h', `
      UCLASS(Blueprintable)
      class CLIENT_API InventoryComponent : public UObject {
        GENERATED_BODY()
      };
    `);
    write(root, 'TypeScript/src/inventory.ts', 'ue.InventoryComponent();');
    write(root, 'TypeScript/Typing/InventoryComponent.ts', 'export declare class InventoryComponent {}');
  };
});
