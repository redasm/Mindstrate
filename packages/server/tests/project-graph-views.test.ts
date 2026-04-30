import * as fs from 'node:fs';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ContextGraphStore } from '../src/context-graph/context-graph-store.js';
import { detectProject } from '../src/project/detector.js';
import { indexProjectGraph } from '../src/project-graph/project-graph-service.js';
import { collectProjectGraphModules } from '../src/project-graph/clustering.js';
import { collectProjectGraphViews } from '../src/project-graph/views.js';
import { createTempDir, removeTempDir } from './test-support.js';
import { PROJECT_GRAPH_METADATA_KEYS, ProjectGraphEdgeKind } from '@mindstrate/protocol/models';

const write = (root: string, rel: string, content: string): void => {
  const abs = path.join(root, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content, 'utf8');
};

describe('project graph views', () => {
  let root: string;
  let store: ContextGraphStore;

  beforeEach(() => {
    root = createTempDir('mindstrate-project-graph-views-');
    store = new ContextGraphStore(path.join(root, '.mindstrate', 'context-graph.db'));
  });

  afterEach(() => {
    store.close();
    removeTempDir(root);
  });

  it('collects dependency, asset, and binding views', () => {
    write(root, 'Client.uproject', '{"FileVersion":3}');
    fs.mkdirSync(path.join(root, 'Content'), { recursive: true });
    fs.mkdirSync(path.join(root, 'Config'), { recursive: true });
    write(root, '.mindstrate/rules/client-views.json', JSON.stringify({
      id: 'client-views',
      name: 'Client Views',
      priority: 200,
      match: { all: [{ glob: '*.uproject' }] },
      detect: { language: 'cpp', framework: 'unreal-engine', manifest: '*.uproject' },
      sourceRoots: ['Source', 'TypeScript/src'],
      manifests: ['*.uproject'],
      layers: [{ id: 'assets', label: 'Assets', roots: ['Content'], parserAdapters: ['unreal-asset-metadata'] }],
    }));
    write(root, 'Source/Client/InventoryComponent.h', `
      UCLASS()
      class InventoryComponent : public UObject {
        GENERATED_BODY()
      };
    `);
    write(root, 'TypeScript/src/inventory.ts', 'ue.InventoryComponent();');
    write(root, '.mindstrate/unreal-asset-registry.json', JSON.stringify({
      assets: [{ path: '/Game/UI/WBP_MainMenu', class: 'WidgetBlueprint', references: ['/Game/Characters/BP_Player'] }],
    }));

    const project = detectProject(root);
    expect(project).not.toBeNull();
    indexProjectGraph(store, project!);

    expect(collectProjectGraphViews(store, 'Client')).toMatchObject({
      dependencies: expect.arrayContaining(['InventoryComponent']),
      assets: ['/Game/UI/WBP_MainMenu'],
      bindings: expect.arrayContaining([{ native: 'InventoryComponent', script: 'InventoryComponent' }]),
    });
    expect(store.listNodes({ project: 'Client', limit: 1000 })
      .find((node) => node.title === 'InventoryComponent' && node.metadata?.[PROJECT_GRAPH_METADATA_KEYS.kind] === 'class')?.metadata?.[
      PROJECT_GRAPH_METADATA_KEYS.evidence
    ]).toEqual(expect.arrayContaining([
      expect.objectContaining({ extractorId: 'unreal-cpp-reflection' }),
    ]));
    expect(store.listEdges({ limit: 1000 }).map((edge) => edge.evidence?.[PROJECT_GRAPH_METADATA_KEYS.kind])).toEqual(
      expect.arrayContaining([ProjectGraphEdgeKind.BINDS_TO, ProjectGraphEdgeKind.REFERENCES_ASSET]),
    );
  });

  it('clusters project graph facts into stable modules', () => {
    write(root, 'Client.uproject', '{"FileVersion":3}');
    write(root, '.mindstrate/rules/client-modules.json', JSON.stringify({
      id: 'client-modules',
      name: 'Client Modules',
      priority: 200,
      match: { all: [{ glob: '*.uproject' }] },
      detect: { language: 'cpp', framework: 'unreal-engine', manifest: '*.uproject' },
      sourceRoots: ['Source', 'Plugins/UnrealSharp/Source'],
      manifests: ['*.uproject'],
    }));
    write(root, 'Source/Client/Client.Build.cs', 'public class Client : ModuleRules {}');
    write(root, 'Source/Client/Private/ClientGameMode.cpp', 'void StartMatch() {}');
    write(root, 'Plugins/UnrealSharp/Source/UnrealSharpCore/UnrealSharpCore.Build.cs', 'public class UnrealSharpCore : ModuleRules {}');
    write(root, 'Plugins/UnrealSharp/Source/UnrealSharpCore/Public/UnrealSharpCore.h', 'class UUnrealSharpCore {};');

    const project = detectProject(root);
    expect(project).not.toBeNull();
    indexProjectGraph(store, project!);

    const modules = collectProjectGraphModules(store, 'Client');
    expect(modules.map((module) => module.id)).toEqual(expect.arrayContaining([
      'module:source/client',
      'module:plugins/unrealsharp/source/unrealsharpcore',
    ]));
    expect(modules.find((module) => module.id === 'module:source/client')).toMatchObject({
      label: 'Source/Client',
      files: expect.arrayContaining(['Source/Client/Client.Build.cs', 'Source/Client/Private/ClientGameMode.cpp']),
    });
  });
});
