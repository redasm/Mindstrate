import * as fs from 'node:fs';
import * as path from 'node:path';
import { createHash } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  PROJECT_GRAPH_METADATA_KEYS,
  ProjectGraphEdgeKind,
  ProjectGraphNodeKind,
} from '@mindstrate/protocol/models';
import { ContextGraphStore } from '../src/context-graph/context-graph-store.js';
import { detectProject } from '../src/project/detector.js';
import { indexProjectGraph, reindexProjectGraphFiles } from '../src/project-graph/project-graph-service.js';
import { readProjectGraphExtractionCache } from '../src/project-graph/extraction-cache.js';
import { createTempDir, removeTempDir } from './test-support.js';

const write = (root: string, rel: string, content: string): void => {
  const abs = path.join(root, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content, 'utf8');
};

describe('project graph service', () => {
  let root: string;
  let store: ContextGraphStore;

  beforeEach(() => {
    root = createTempDir('mindstrate-project-graph-service-');
    store = new ContextGraphStore(path.join(root, '.mindstrate', 'context-graph.db'));
  });

  afterEach(() => {
    store.close();
    removeTempDir(root);
  });

  it('records scan-plan structure for deep, metadata-only, and generated roots', () => {
    write(root, 'Client.uproject', '{"FileVersion":3}');
    write(root, 'Source/Game/Player.cpp', 'void Fire() {}');
    write(root, 'Config/DefaultGame.ini', [
      '[/Script/EngineSettings.GeneralProjectSettings]',
      'GameInstanceClass=/Script/Client.ClientGameInstance',
      '+ActivePlugins=CommonUI',
    ].join('\n'));
    write(root, 'Content/UI/WBP_MainMenu.uasset', 'binary');
    write(root, 'TypeScript/Typing/ue/generated/Script/Engine/Actor.d.ts', 'declare class Actor {}');
    write(root, 'TypeScript/Typing/Game/Foo.d.ts', 'declare class Foo {}');

    const project = detectProject(root);
    expect(project).not.toBeNull();
    indexProjectGraph(store, project!);

    const nodes = store.listNodes({ project: 'Client', limit: 100 });
    const projectNode = nodes.find((node) => node.metadata?.[PROJECT_GRAPH_METADATA_KEYS.kind] === ProjectGraphNodeKind.PROJECT);
    const sourceNode = nodes.find((node) => node.title === 'Source');
    const contentNode = nodes.find((node) => node.title === 'Content');
    const generatedNode = nodes.find((node) => node.title === 'TypeScript/Typing');
    const generatedFile = nodes.find((node) => node.title.endsWith('Actor.d.ts'));
    const siblingGeneratedFile = nodes.find((node) => node.title.endsWith('Foo.d.ts'));

    expect(projectNode).toBeDefined();
    expect(sourceNode?.metadata).toMatchObject({ scanMode: 'deep' });
    expect(contentNode?.metadata).toMatchObject({ scanMode: 'metadata-only' });
    expect(generatedNode?.metadata).toMatchObject({ scanMode: 'generated' });
    expect(nodes.find((node) => node.title === 'Content/UI/WBP_MainMenu.uasset')).toBeUndefined();
    expect(generatedFile).toBeUndefined();
    expect(siblingGeneratedFile).toBeUndefined();
    expect(store.listEdges({ limit: 100 }).filter((edge) =>
      edge.evidence?.[PROJECT_GRAPH_METADATA_KEYS.kind] === ProjectGraphEdgeKind.CONTAINS
    ).length).toBeGreaterThanOrEqual(3);
  });

  it('extracts Unreal C++ reflection symbols and Build.cs module dependencies', () => {
    write(root, 'Client.uproject', JSON.stringify({
      FileVersion: 3,
      Modules: [{ Name: 'Client', Type: 'Runtime', LoadingPhase: 'Default' }],
      Plugins: [{ Name: 'EnhancedInput', Enabled: true }],
    }));
    write(root, 'Config/DefaultGame.ini', [
      '[/Script/EngineSettings.GeneralProjectSettings]',
      'GameInstanceClass=/Script/Client.ClientGameInstance',
      '+ActivePlugins=CommonUI',
    ].join('\n'));
    fs.mkdirSync(path.join(root, 'Content'), { recursive: true });
    write(root, 'Plugins/Inventory/Inventory.uplugin', JSON.stringify({
      FileVersion: 3,
      Modules: [{ Name: 'Inventory', Type: 'Runtime', LoadingPhase: 'PreDefault' }],
      Plugins: [{ Name: 'GameplayAbilities', Enabled: true }],
    }));
    write(root, 'Source/Client/Client.Build.cs', `
      public class Client : ModuleRules {
        public Client(ReadOnlyTargetRules Target) : base(Target) {
          PublicDependencyModuleNames.AddRange(new string[] { "Core", "Engine", "UMG" });
          PrivateDependencyModuleNames.Add("Slate");
        }
      }
    `);
    write(root, 'Source/Client/PlayerCharacter.h', `
      UCLASS(Blueprintable)
      class CLIENT_API APlayerCharacter : public ACharacter {
        GENERATED_BODY()
      public:
        UFUNCTION(BlueprintCallable)
        void FireWeapon();

        UPROPERTY(EditAnywhere)
        int32 Health;
      };
    `);

    const project = detectProject(root);
    expect(project).not.toBeNull();
    indexProjectGraph(store, project!);

    const nodes = store.listNodes({ project: 'Client', limit: 500 });
    const edges = store.listEdges({ limit: 500 });

    expect(nodes.find((node) => node.title === 'APlayerCharacter')?.metadata).toMatchObject({
      kind: ProjectGraphNodeKind.CLASS,
    });
    expect(nodes.find((node) => node.title === 'FireWeapon')?.metadata).toMatchObject({
      kind: ProjectGraphNodeKind.FUNCTION,
    });
    expect(nodes.find((node) => node.title === 'Health')?.metadata).toMatchObject({
      kind: ProjectGraphNodeKind.CONFIG,
    });
    expect(nodes.find((node) => node.title === 'Engine')?.metadata).toMatchObject({
      kind: ProjectGraphNodeKind.DEPENDENCY,
    });
    expect(nodes.find((node) => node.title === 'Engine')?.metadata?.[PROJECT_GRAPH_METADATA_KEYS.evidence]).toEqual(
      expect.arrayContaining([expect.objectContaining({ extractorId: 'unreal-build-regex' })]),
    );
    expect(edges.some((edge) =>
      edge.evidence?.[PROJECT_GRAPH_METADATA_KEYS.kind] === ProjectGraphEdgeKind.DEFINES
    )).toBe(true);
    expect(edges.some((edge) =>
      edge.evidence?.[PROJECT_GRAPH_METADATA_KEYS.kind] === ProjectGraphEdgeKind.DEPENDS_ON
    )).toBe(true);

    const clientModule = nodes.find((node) => node.title === 'Client' && node.metadata?.kind === ProjectGraphNodeKind.MODULE);
    const inventoryModule = nodes.find((node) => node.title === 'Inventory' && node.metadata?.kind === ProjectGraphNodeKind.MODULE);
    const projectManifest = nodes.find((node) => node.title === 'Client.uproject');
    const buildFile = nodes.find((node) => node.title === 'Source/Client/Client.Build.cs');
    const configFile = nodes.find((node) => node.title === 'Config/DefaultGame.ini');
    const enhancedInput = nodes.find((node) => node.title === 'EnhancedInput');
    const gameplayAbilities = nodes.find((node) => node.title === 'GameplayAbilities');
    const engine = nodes.find((node) => node.title === 'Engine');
    const slate = nodes.find((node) => node.title === 'Slate');
    const configuredClass = nodes.find((node) => node.title === 'ClientGameInstance');
    const configuredPlugin = nodes.find((node) => node.title === 'CommonUI');

    expect(clientModule?.metadata).toMatchObject({
      unrealModule: true,
      manifestType: 'project',
      moduleType: 'Runtime',
      loadingPhase: 'Default',
      dependencySurface: { public: ['Core', 'Engine', 'UMG'], private: ['Slate'] },
      runtimeModule: true,
      impactTags: expect.arrayContaining(['runtime-module']),
    });
    expect(inventoryModule?.metadata).toMatchObject({
      unrealModule: true,
      manifestType: 'plugin',
      moduleType: 'Runtime',
      loadingPhase: 'PreDefault',
      runtimeModule: true,
    });
    expect(projectManifest?.metadata).toMatchObject({
      buildCritical: true,
      impactTags: expect.arrayContaining(['project-manifest', 'build-critical']),
    });
    expect(buildFile?.metadata).toMatchObject({
      buildCritical: true,
      impactTags: expect.arrayContaining(['build-critical']),
    });
    expect(configFile?.metadata).toMatchObject({
      configSensitive: true,
      impactTags: expect.arrayContaining(['config-sensitive']),
    });
    expect(enhancedInput?.metadata).toMatchObject({ unrealPlugin: true, enabled: true });
    expect(gameplayAbilities?.metadata).toMatchObject({ unrealPlugin: true, enabled: true });
    expect(edges.some((edge) =>
      edge.sourceId === clientModule?.id
      && edge.targetId === engine?.id
      && edge.evidence?.dependencyKind === 'unreal-module'
      && edge.evidence?.dependencyScope === 'public'
    )).toBe(true);
    expect(edges.some((edge) =>
      edge.sourceId === clientModule?.id
      && edge.targetId === slate?.id
      && edge.evidence?.dependencyKind === 'unreal-module'
      && edge.evidence?.dependencyScope === 'private'
    )).toBe(true);
    expect(edges.some((edge) =>
      edge.targetId === enhancedInput?.id
      && edge.evidence?.dependencyKind === 'unreal-plugin'
      && edge.evidence?.enabled === true
    )).toBe(true);
    expect(configuredClass?.metadata).toMatchObject({ configReferenceKind: 'unreal.config.class' });
    expect(configuredPlugin?.metadata).toMatchObject({ configReferenceKind: 'unreal.config.plugin' });
    expect(edges.some((edge) =>
      edge.targetId === configuredClass?.id
      && edge.evidence?.[PROJECT_GRAPH_METADATA_KEYS.kind] === ProjectGraphEdgeKind.CONFIGURES
    )).toBe(true);
  });

  it('extracts script imports, symbols, and UE calls across gameplay languages', () => {
    write(root, 'Client.uproject', '{"FileVersion":3}');
    fs.mkdirSync(path.join(root, 'Content'), { recursive: true });
    fs.mkdirSync(path.join(root, 'Config'), { recursive: true });
    fs.mkdirSync(path.join(root, 'Source'), { recursive: true });
    write(root, '.mindstrate/rules/client-scripts.json', JSON.stringify({
      id: 'client-scripts',
      name: 'Client Scripts',
      priority: 200,
      match: { all: [{ glob: '*.uproject' }] },
      detect: { language: 'cpp', framework: 'unreal-engine', manifest: '*.uproject' },
      sourceRoots: ['Source', 'Lua', 'Python', 'CSharp', 'TypeScript/src'],
      generatedRoots: ['TypeScript/Typing'],
      layers: [],
      manifests: ['*.uproject'],
    }));
    write(root, 'Lua/inventory.lua', `
      local Inventory = require("game.inventory")
      function Inventory.Open()
        UE.InventoryComponent()
      end
    `);
    write(root, 'Python/tools.py', `
      import unreal
      class ImportTool:
        def run(self):
          unreal.EditorAssetLibrary()
    `);
    write(root, 'CSharp/Game/Weapon.cs', `
      using Game.Inventory;
      public class Weapon {
        public void Fire() { UE.FireWeapon(); }
      }
    `);
    write(root, 'TypeScript/src/ui.ts', `
      import { Inventory } from "./inventory";
      ue.InventoryComponent();
    `);
    write(root, 'TypeScript/Typing/Game/Foo.d.ts', 'declare class Foo {}');

    const project = detectProject(root);
    expect(project).not.toBeNull();
    indexProjectGraph(store, project!);

    const nodes = store.listNodes({ project: 'Client', limit: 200 });
    const typingFile = nodes.find((node) => node.title.endsWith('Foo.d.ts'));

    expect(nodes.find((node) => node.title === 'game.inventory')).toBeDefined();
    expect(nodes.find((node) => node.title === 'ImportTool')?.metadata).toMatchObject({ kind: ProjectGraphNodeKind.CLASS });
    expect(nodes.find((node) => node.title === 'ImportTool')?.metadata?.[PROJECT_GRAPH_METADATA_KEYS.evidence]).toEqual(
      expect.arrayContaining([expect.objectContaining({ extractorId: 'tree-sitter-source' })]),
    );
    expect(nodes.find((node) => node.title === 'Fire')?.metadata).toMatchObject({ kind: ProjectGraphNodeKind.FUNCTION });
    expect(nodes.find((node) => node.title === 'Fire')?.metadata?.[PROJECT_GRAPH_METADATA_KEYS.evidence]).toEqual(
      expect.arrayContaining([expect.objectContaining({ extractorId: 'tree-sitter-source' })]),
    );
    expect(nodes.find((node) => node.title === 'InventoryComponent')).toBeDefined();
    expect(nodes.some((node) => node.metadata?.kind === ProjectGraphNodeKind.DEPENDENCY)).toBe(true);
    expect(typingFile).toBeUndefined();
  });

  it('extracts tree-sitter call and hook edges for execution flow queries', () => {
    write(root, 'package.json', JSON.stringify({ name: 'call-chain-demo' }));
    write(root, 'src/App.tsx', [
      'import { useState } from "react";',
      'export { formatCount } from "./format";',
      'function loadData() { return 1; }',
      'export function App() {',
      '  const [count] = useState(loadData());',
      '  analytics.track(count);',
      '  return <main>{count}</main>;',
      '}',
    ].join('\n'));

    const project = detectProject(root);
    expect(project).not.toBeNull();
    indexProjectGraph(store, project!);

    const nodes = store.listNodes({ project: 'call-chain-demo', limit: 200 });
    const edges = store.listEdges({ limit: 200 });

    expect(nodes.find((node) => node.title === 'loadData')).toBeDefined();
    expect(nodes.find((node) => node.title === './format')).toBeDefined();
    // Method chain `analytics.track(count)` is captured at the leaf
    // property identifier (`track`) rather than the full member-expression
    // text (`analytics.track`). Capturing the entire member_expression text
    // used to produce unbounded labels for chained calls like
    // `bundleCommand.command(...).description(...).option(...)`, which
    // poisoned the dependency node id, label, and Obsidian per-node page
    // filename slug — the latter overflowing Windows MAX_PATH and killing
    // the whole projection write. See `query-pack.ts` for the tightened
    // tree-sitter query.
    expect(nodes.find((node) => node.title === 'track')).toBeDefined();
    expect(edges.some((edge) => edge.evidence?.[PROJECT_GRAPH_METADATA_KEYS.kind] === ProjectGraphEdgeKind.CALLS)).toBe(true);
    expect(edges.some((edge) => edge.evidence?.[PROJECT_GRAPH_METADATA_KEYS.kind] === ProjectGraphEdgeKind.USES_HOOK)).toBe(true);
    expect(edges.some((edge) => edge.evidence?.[PROJECT_GRAPH_METADATA_KEYS.kind] === ProjectGraphEdgeKind.EXPORTS)).toBe(true);
  });

  it('links native Unreal symbols to script-side UE calls', () => {
    write(root, 'Client.uproject', '{"FileVersion":3}');
    fs.mkdirSync(path.join(root, 'Content'), { recursive: true });
    fs.mkdirSync(path.join(root, 'Config'), { recursive: true });
    write(root, '.mindstrate/rules/client-bindings.json', JSON.stringify({
      id: 'client-bindings',
      name: 'Client Bindings',
      priority: 200,
      match: { all: [{ glob: '*.uproject' }] },
      detect: { language: 'cpp', framework: 'unreal-engine', manifest: '*.uproject' },
      sourceRoots: ['Source', 'Lua', 'TypeScript/src', 'TypeScript/Typing'],
      generatedRoots: ['TypeScript/Typing'],
      layers: [],
      manifests: ['*.uproject'],
    }));
    write(root, 'Source/Client/InventoryComponent.h', `
      UCLASS(Blueprintable)
      class CLIENT_API InventoryComponent : public UObject {
        GENERATED_BODY()
      public:
        UFUNCTION(BlueprintCallable)
        void OpenInventory();
      };
    `);
    write(root, 'Lua/inventory.lua', 'UE.InventoryComponent()');
    write(root, 'TypeScript/src/inventory.ts', 'ue.OpenInventory();');
    write(root, 'TypeScript/Typing/InventoryComponent.ts', 'export declare class InventoryComponent {}');

    const project = detectProject(root);
    expect(project).not.toBeNull();
    indexProjectGraph(store, project!);

    const nodes = store.listNodes({ project: 'Client', limit: 200 });
    const bindingEdges = store.listEdges({ limit: 200 }).filter((edge) =>
      edge.evidence?.[PROJECT_GRAPH_METADATA_KEYS.kind] === ProjectGraphEdgeKind.BINDS_TO
    );
    const generatedEdges = store.listEdges({ limit: 200 }).filter((edge) =>
      edge.evidence?.[PROJECT_GRAPH_METADATA_KEYS.kind] === ProjectGraphEdgeKind.GENERATED_FROM
    );
    const labelsById = new Map(nodes.map((node) => [node.id, node.title]));
    const generatedFile = nodes.find((node) => node.title === 'TypeScript/Typing/InventoryComponent.ts');

    expect(bindingEdges.map((edge) => [labelsById.get(edge.sourceId), labelsById.get(edge.targetId)])).toEqual(
      expect.arrayContaining([
        ['InventoryComponent', 'InventoryComponent'],
        ['OpenInventory', 'OpenInventory'],
      ]),
    );
    expect(generatedFile?.metadata).toMatchObject({
      generated: true,
      doNotEdit: true,
      metadataOnly: true,
      impactTags: expect.arrayContaining(['generated', 'do-not-edit']),
      sourceGeneratedFrom: expect.any(String),
    });
    expect(generatedEdges.map((edge) => [labelsById.get(edge.sourceId), labelsById.get(edge.targetId)])).toContainEqual([
      'TypeScript/Typing/InventoryComponent.ts',
      'InventoryComponent',
    ]);
  });

  it('imports Unreal Asset Registry exports as metadata-only asset relationships', () => {
    write(root, 'Client.uproject', '{"FileVersion":3}');
    fs.mkdirSync(path.join(root, 'Content'), { recursive: true });
    fs.mkdirSync(path.join(root, 'Config'), { recursive: true });
    fs.mkdirSync(path.join(root, 'Source'), { recursive: true });
    write(root, '.mindstrate/unreal-asset-registry.json', JSON.stringify({
      assets: [
        {
          path: '/Game/UI/WBP_MainMenu',
          class: 'WidgetBlueprint',
          parent: 'UUserWidget',
          references: [{ path: '/Game/Data/DA_MenuTheme', type: 'hard' }],
          softReferences: ['/Game/Audio/DA_MenuMusic'],
        },
        {
          path: '/Game/Data/DA_MenuTheme',
          class: 'DataAsset',
          references: [],
        },
      ],
    }));

    const project = detectProject(root);
    expect(project).not.toBeNull();
    indexProjectGraph(store, project!);

    const nodes = store.listNodes({ project: 'Client', limit: 500 });
    const edges = store.listEdges({ limit: 500 });
    const menu = nodes.find((node) => node.title === '/Game/UI/WBP_MainMenu');
    const parent = nodes.find((node) => node.title === 'UUserWidget');
    const theme = nodes.find((node) => node.title === '/Game/Data/DA_MenuTheme');
    const music = nodes.find((node) => node.title === '/Game/Audio/DA_MenuMusic');

    expect(menu?.metadata).toMatchObject({
      assetClass: 'WidgetBlueprint',
      scanMode: 'metadata-only',
      assetReferenceSensitive: true,
      impactTags: expect.arrayContaining(['asset-reference-sensitive']),
    });
    expect(parent?.metadata).toMatchObject({ kind: ProjectGraphNodeKind.CLASS });
    expect(theme?.metadata).toMatchObject({ assetClass: 'DataAsset', scanMode: 'metadata-only' });
    expect(edges.some((edge) =>
      edge.sourceId === menu?.id &&
      edge.targetId === parent?.id &&
      edge.evidence?.[PROJECT_GRAPH_METADATA_KEYS.kind] === ProjectGraphEdgeKind.DEPENDS_ON
    )).toBe(true);
    expect(edges.some((edge) =>
      edge.sourceId === menu?.id &&
      edge.targetId === theme?.id &&
      edge.evidence?.[PROJECT_GRAPH_METADATA_KEYS.kind] === ProjectGraphEdgeKind.REFERENCES_ASSET &&
      edge.evidence?.referenceType === 'hard'
    )).toBe(true);
    expect(edges.some((edge) =>
      edge.sourceId === menu?.id &&
      edge.targetId === music?.id &&
      edge.evidence?.[PROJECT_GRAPH_METADATA_KEYS.kind] === ProjectGraphEdgeKind.REFERENCES_ASSET &&
      edge.evidence?.referenceType === 'soft'
    )).toBe(true);
  });

  it('writes a file extraction cache for unchanged files', () => {
    write(root, 'package.json', JSON.stringify({ name: 'cached-demo', dependencies: { react: '^19.0.0' } }));
    write(root, 'src/App.tsx', 'export function App() { return <main />; }');

    const project = detectProject(root);
    expect(project).not.toBeNull();
    indexProjectGraph(store, project!);
    const firstCache = readProjectGraphExtractionCache(root);

    expect(firstCache.files['src/App.tsx']?.nodes.length).toBeGreaterThan(0);
    indexProjectGraph(store, project!);
    const secondCache = readProjectGraphExtractionCache(root);

    expect(secondCache.files['src/App.tsx']?.hash).toBe(firstCache.files['src/App.tsx']?.hash);
    expect(secondCache.files['src/App.tsx']?.nodes).toEqual(firstCache.files['src/App.tsx']?.nodes);
  });

  it('ignores stale extraction caches from older extractor pipelines', () => {
    write(root, 'Client.uproject', '{"FileVersion":3}');
    fs.mkdirSync(path.join(root, 'Content'), { recursive: true });
    fs.mkdirSync(path.join(root, 'Config'), { recursive: true });
    fs.mkdirSync(path.join(root, 'Source'), { recursive: true });
    write(root, '.mindstrate/rules/client-scripts.json', JSON.stringify({
      id: 'client-scripts',
      name: 'Client Scripts',
      priority: 200,
      match: { all: [{ glob: '*.uproject' }] },
      detect: { language: 'cpp', framework: 'unreal-engine', manifest: '*.uproject' },
      sourceRoots: ['Source', 'Python'],
      layers: [],
      manifests: ['*.uproject'],
    }));
    const script = 'class ImportTool:\n  pass\n';
    write(root, 'Python/tools.py', script);
    // A cache written by an older extractor pipeline (incompatible version
    // header) must be ignored so the file is freshly re-extracted.
    const cachePath = path.join(root, '.mindstrate', 'project-graph-extract-cache.ndjson');
    fs.mkdirSync(path.dirname(cachePath), { recursive: true });
    fs.writeFileSync(cachePath, `${JSON.stringify({ version: 1 })}\n${JSON.stringify({
      path: 'Python/tools.py',
      hash: createHash('sha256').update(script).digest('hex'),
      nodes: [],
      edges: [],
    })}\n`, 'utf8');

    const project = detectProject(root);
    expect(project).not.toBeNull();
    indexProjectGraph(store, project!);
    const rewritten = readProjectGraphExtractionCache(root);

    expect(rewritten.version).toBe(3);
    expect(store.listNodes({ project: 'Client', limit: 100 }).find((node) => node.title === 'ImportTool')).toBeDefined();
  });

  it('reports extraction, binding, cache, and writing progress', () => {
    write(root, 'package.json', JSON.stringify({ name: 'progress-demo' }));
    write(root, 'src/App.tsx', 'export function App() { return <main />; }');

    const project = detectProject(root);
    expect(project).not.toBeNull();
    const phases: string[] = [];
    indexProjectGraph(store, project!, {
      onIndexProgress: (event) => phases.push(event.phase),
    });

    expect(phases).toEqual(expect.arrayContaining(['extracting', 'binding', 'cache', 'writing']));
  });

  it('reports generated, metadata-only, and skipped files during large scans', () => {
    write(root, 'Scan.uproject', '{"FileVersion":3}');
    write(root, '.mindstrate/rules/scan-progress.json', JSON.stringify({
      id: 'scan-progress',
      name: 'Scan Progress',
      priority: 200,
      match: { all: [{ glob: '*.uproject' }] },
      detect: { language: 'cpp', framework: 'unreal-engine', manifest: '*.uproject' },
      sourceRoots: ['Source', 'TypeScript/Typing', 'Content'],
      generatedRoots: ['TypeScript/Typing'],
      layers: [{ id: 'assets', label: 'Assets', roots: ['Content'], parserAdapters: ['unreal-asset-metadata'] }],
      manifests: ['*.uproject'],
    }));
    write(root, 'Source/Game/Game.cpp', 'void StartGame() {}');
    write(root, 'TypeScript/Typing/UObject.ts', 'export declare class UObject {}');
    write(root, 'Content/UI/WBP_Menu.uasset', '');

    const project = detectProject(root);
    expect(project).not.toBeNull();
    const indexProgress: Array<{ generatedFiles?: number; metadataOnlyRoots?: number; skippedFiles?: number }> = [];
    const scanProgress: Array<{ phase: string; path: string; skippedFiles?: number }> = [];
    indexProjectGraph(store, project!, {
      onScanProgress: (event) => scanProgress.push(event),
      onIndexProgress: (event) => indexProgress.push(event),
    });

    expect(indexProgress.at(-1)).toMatchObject({
      generatedFiles: 1,
      metadataOnlyRoots: 1,
      skippedFiles: expect.any(Number),
    });
    expect(scanProgress.some((event) => event.phase === 'file' && event.path === 'TypeScript/Typing/UObject.ts')).toBe(true);
  });

  it('extracts TypeScript class, methods, and intra-file call edges', () => {
    write(root, 'Client.uproject', '{"FileVersion":3}');
    // A class-based TS module like the game's Game layer: methods calling each
    // other, an arrow-function field, and a top-level helper.
    write(root, 'TypeScript/Src/Game/MapModel.ts', [
      "import { EventDefine } from '../Core/Event/EventDefine';",
      '',
      'export class MapModel {',
      '  private nextMark = 0;',
      '',
      '  public UpdateNextCustomMarkNumber(): number {',
      '    this.nextMark = computeNext(this.nextMark);',
      '    return this.nextMark;',
      '  }',
      '',
      '  private reset = (): void => {',
      '    this.nextMark = 0;',
      '  };',
      '}',
      '',
      'function computeNext(n: number): number {',
      '  return n + 1;',
      '}',
    ].join('\n'));

    const project = detectProject(root);
    expect(project).not.toBeNull();
    indexProjectGraph(store, project!);

    const nodes = store.listNodes({ project: 'Client', limit: 500 });
    const kindOf = (node: { metadata?: Record<string, unknown> }) =>
      node.metadata?.[PROJECT_GRAPH_METADATA_KEYS.kind];

    // Class node + method/function symbol nodes (the previously-missing pieces).
    const classNode = nodes.find((n) => kindOf(n) === ProjectGraphNodeKind.CLASS && n.title === 'MapModel');
    const methodNode = nodes.find((n) => kindOf(n) === ProjectGraphNodeKind.FUNCTION && n.title === 'UpdateNextCustomMarkNumber');
    const arrowField = nodes.find((n) => kindOf(n) === ProjectGraphNodeKind.FUNCTION && n.title === 'reset');
    const helper = nodes.find((n) => kindOf(n) === ProjectGraphNodeKind.FUNCTION && n.title === 'computeNext');
    expect(classNode).toBeDefined();
    expect(methodNode).toBeDefined();
    expect(arrowField).toBeDefined();
    expect(helper).toBeDefined();

    // The uppercase method must NOT be misclassified as a React component.
    expect(nodes.find((n) => kindOf(n) === ProjectGraphNodeKind.COMPONENT && n.title === 'UpdateNextCustomMarkNumber')).toBeUndefined();

    // Intra-file call: UpdateNextCustomMarkNumber calls computeNext → a CALLS
    // edge from the file to the computeNext FUNCTION definition node (not a
    // bare DEPENDENCY node).
    const edges = store.listEdges({ limit: 1000 });
    const callToHelper = edges.find((edge) =>
      edge.evidence?.[PROJECT_GRAPH_METADATA_KEYS.kind] === ProjectGraphEdgeKind.CALLS
      && edge.targetId === helper!.id);
    expect(callToHelper).toBeDefined();
  });

  it('incrementally re-extracts changed files, replacing removed symbols', () => {
    write(root, 'Client.uproject', '{"FileVersion":3}');
    write(root, 'TypeScript/Src/Game/Combat.ts', [
      'export class Combat {',
      '  public startFight(): void { prepare(); }',
      '}',
      'function prepare(): void {}',
    ].join('\n'));

    const project = detectProject(root)!;
    indexProjectGraph(store, project);

    const funcTitles = () => store.listNodes({ project: 'Client', limit: 500 })
      .filter((n) => n.metadata?.[PROJECT_GRAPH_METADATA_KEYS.kind] === ProjectGraphNodeKind.FUNCTION
        && n.status === 'active')
      .map((n) => n.title);
    expect(funcTitles()).toContain('startFight');
    expect(funcTitles()).toContain('prepare');

    // Edit the file: rename the method, drop the helper.
    write(root, 'TypeScript/Src/Game/Combat.ts', [
      'export class Combat {',
      '  public endFight(): void {}',
      '}',
    ].join('\n'));

    const result = reindexProjectGraphFiles(store, project, ['TypeScript/Src/Game/Combat.ts']);
    expect(result.filesReindexed).toBe(1);

    const active = funcTitles();
    expect(active).toContain('endFight');
    // The removed symbols are archived (no longer active), not left dangling.
    expect(active).not.toContain('startFight');
    expect(active).not.toContain('prepare');
  });

  it('archives a file\'s symbols when the file is deleted upstream', () => {
    write(root, 'Client.uproject', '{"FileVersion":3}');
    write(root, 'TypeScript/Src/Game/Temp.ts', 'export function willVanish(): void {}');

    const project = detectProject(root)!;
    indexProjectGraph(store, project);
    expect(store.listNodes({ project: 'Client', limit: 500 })
      .some((n) => n.title === 'willVanish' && n.status === 'active')).toBe(true);

    fs.rmSync(path.join(root, 'TypeScript/Src/Game/Temp.ts'));
    const result = reindexProjectGraphFiles(store, project, ['TypeScript/Src/Game/Temp.ts']);
    expect(result.filesRemoved).toBe(1);
    expect(store.listNodes({ project: 'Client', limit: 500 })
      .some((n) => n.title === 'willVanish' && n.status === 'active')).toBe(false);
  });

  it('builds a full directory chain so deep files are reachable from the project root', () => {
    write(root, 'Client.uproject', '{"FileVersion":3}');
    write(root, 'TypeScript/Src/Game/MapModel.ts', 'export class MapModel {}');

    const project = detectProject(root)!;
    indexProjectGraph(store, project);

    const nodes = store.listNodes({ project: 'Client', limit: 2000 });
    const kindOf = (n: { metadata?: Record<string, unknown> }) => n.metadata?.[PROJECT_GRAPH_METADATA_KEYS.kind];
    const dirTitle = (t: string) =>
      nodes.find((n) => kindOf(n) === ProjectGraphNodeKind.DIRECTORY && n.title === t);

    // Every intermediate directory must exist as its own node (previously only
    // the top-level deep-root `TypeScript` did, collapsing the rest).
    expect(dirTitle('TypeScript')).toBeDefined();
    expect(dirTitle('TypeScript/Src')).toBeDefined();
    expect(dirTitle('TypeScript/Src/Game')).toBeDefined();

    // And they must chain project → TypeScript → Src → Game → file via CONTAINS,
    // so the bounded root view can drill down to the deep file.
    const edges = store.listEdges({ limit: 5000 });
    const contains = (fromId: string, toId: string) =>
      edges.some((e) =>
        e.evidence?.[PROJECT_GRAPH_METADATA_KEYS.kind] === ProjectGraphEdgeKind.CONTAINS
        && e.sourceId === fromId && e.targetId === toId);

    const projectNode = nodes.find((n) => kindOf(n) === ProjectGraphNodeKind.PROJECT)!;
    const ts = dirTitle('TypeScript')!;
    const src = dirTitle('TypeScript/Src')!;
    const game = dirTitle('TypeScript/Src/Game')!;
    const file = nodes.find((n) => kindOf(n) === ProjectGraphNodeKind.FILE && n.title.endsWith('Game/MapModel.ts'))!;

    expect(projectNode && ts && contains(projectNode.id, ts.id)).toBeTruthy();
    expect(contains(ts.id, src.id)).toBe(true);
    expect(contains(src.id, game.id)).toBe(true);
    expect(file && contains(game.id, file.id)).toBeTruthy();
  });

  it('does not create dependency nodes for language builtins / test-framework calls', () => {
    write(root, 'Client.uproject', '{"FileVersion":3}');
    write(root, 'TypeScript/Src/Game/Widget.ts', [
      'export class Widget {',
      '  render(): void {',
      '    const x = [1, 2].map((n) => n + 1);',   // map is a builtin-ish global we filter
      '    doWork(x);',                              // real project call -> should survive
      '  }',
      '}',
      'function doWork(v: number[]): void { return; }',
    ].join('\n'));
    write(root, 'TypeScript/Src/Test/Widget.test.ts', [
      'describe("Widget", () => {',
      '  it("renders", () => {',
      '    expect(1).toEqual(1);',
      '  });',
      '});',
    ].join('\n'));

    const project = detectProject(root)!;
    indexProjectGraph(store, project);

    const nodes = store.listNodes({ project: 'Client', limit: 2000 });
    const depTitles = new Set(
      nodes
        .filter((n) => n.metadata?.[PROJECT_GRAPH_METADATA_KEYS.kind] === ProjectGraphNodeKind.DEPENDENCY)
        .map((n) => n.title),
    );
    // Builtins / test globals must NOT be dependency nodes.
    for (const noise of ['expect', 'it', 'describe', 'toEqual', 'map']) {
      expect(depTitles.has(noise)).toBe(false);
    }
    // The real intra-file call still resolves to the local function definition.
    const doWork = nodes.find((n) =>
      n.metadata?.[PROJECT_GRAPH_METADATA_KEYS.kind] === ProjectGraphNodeKind.FUNCTION && n.title === 'doWork');
    expect(doWork).toBeDefined();
  });

  it('honors a rule-provided callNoiseSymbols override', () => {
    write(root, 'Client.uproject', '{"FileVersion":3}');
    // Custom rule: filter only `bespokeGlobal`, and NOT the built-in defaults.
    write(root, '.mindstrate/rules/nami.json', JSON.stringify({
      id: 'nami-custom',
      name: 'NAMI Custom',
      priority: 300,
      match: { all: [{ glob: '*.uproject' }] },
      detect: { language: 'cpp', framework: 'unreal-engine', manifest: '*.uproject' },
      sourceRoots: ['TypeScript'],
      callNoiseSymbols: ['bespokeGlobal'],
    }));
    write(root, 'TypeScript/Src/Game/Caller.ts', [
      'export function run(): void {',
      '  bespokeGlobal();',   // overridden noise -> filtered
      '  expect(1);',          // default noise, but NOT in the override -> kept as dependency
      '}',
    ].join('\n'));

    const project = detectProject(root)!;
    expect(project.graphHints?.callNoiseSymbols).toEqual(['bespokeGlobal']);
    indexProjectGraph(store, project);

    const depTitles = new Set(
      store.listNodes({ project: 'Client', limit: 2000 })
        .filter((n) => n.metadata?.[PROJECT_GRAPH_METADATA_KEYS.kind] === ProjectGraphNodeKind.DEPENDENCY)
        .map((n) => n.title),
    );
    expect(depTitles.has('bespokeGlobal')).toBe(false); // override filtered it
    expect(depTitles.has('expect')).toBe(true);          // default no longer applies
  });
});
