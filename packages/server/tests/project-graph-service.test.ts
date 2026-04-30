import * as fs from 'node:fs';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  PROJECT_GRAPH_METADATA_KEYS,
  ProjectGraphEdgeKind,
  ProjectGraphNodeKind,
} from '@mindstrate/protocol/models';
import { ContextGraphStore } from '../src/context-graph/context-graph-store.js';
import { detectProject } from '../src/project/detector.js';
import { indexProjectGraph } from '../src/project-graph/project-graph-service.js';
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
    write(root, 'Config/DefaultGame.ini', '[/Script/EngineSettings.GeneralProjectSettings]');
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
    expect(generatedFile).toBeUndefined();
    expect(siblingGeneratedFile).toBeUndefined();
    expect(store.listEdges({ limit: 100 }).filter((edge) =>
      edge.evidence?.[PROJECT_GRAPH_METADATA_KEYS.kind] === ProjectGraphEdgeKind.CONTAINS
    ).length).toBeGreaterThanOrEqual(3);
  });

  it('extracts Unreal C++ reflection symbols and Build.cs module dependencies', () => {
    write(root, 'Client.uproject', '{"FileVersion":3}');
    write(root, 'Config/DefaultGame.ini', '[/Script/EngineSettings.GeneralProjectSettings]');
    fs.mkdirSync(path.join(root, 'Content'), { recursive: true });
    write(root, 'Source/Client/Client.Build.cs', `
      public class Client : ModuleRules {
        public Client(ReadOnlyTargetRules Target) : base(Target) {
          PublicDependencyModuleNames.AddRange(new string[] { "Core", "Engine", "UMG" });
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

    const nodes = store.listNodes({ project: 'Client', limit: 100 });
    const edges = store.listEdges({ limit: 100 });

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
    expect(edges.some((edge) =>
      edge.evidence?.[PROJECT_GRAPH_METADATA_KEYS.kind] === ProjectGraphEdgeKind.DEFINES
    )).toBe(true);
    expect(edges.some((edge) =>
      edge.evidence?.[PROJECT_GRAPH_METADATA_KEYS.kind] === ProjectGraphEdgeKind.DEPENDS_ON
    )).toBe(true);
  });

  it('extracts script imports, symbols, and UE calls across gameplay languages', () => {
    write(root, 'Client.uproject', '{"FileVersion":3}');
    fs.mkdirSync(path.join(root, 'Content'), { recursive: true });
    fs.mkdirSync(path.join(root, 'Config'), { recursive: true });
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
    expect(nodes.find((node) => node.title === 'Fire')?.metadata).toMatchObject({ kind: ProjectGraphNodeKind.FUNCTION });
    expect(nodes.find((node) => node.title === 'InventoryComponent')).toBeDefined();
    expect(nodes.some((node) => node.metadata?.kind === ProjectGraphNodeKind.DEPENDENCY)).toBe(true);
    expect(typingFile).toBeUndefined();
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
      sourceRoots: ['Source', 'Lua', 'TypeScript/src'],
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

    const project = detectProject(root);
    expect(project).not.toBeNull();
    indexProjectGraph(store, project!);

    const nodes = store.listNodes({ project: 'Client', limit: 200 });
    const exportsEdges = store.listEdges({ limit: 200 }).filter((edge) =>
      edge.evidence?.[PROJECT_GRAPH_METADATA_KEYS.kind] === ProjectGraphEdgeKind.EXPORTS
    );
    const labelsById = new Map(nodes.map((node) => [node.id, node.title]));

    expect(exportsEdges.map((edge) => [labelsById.get(edge.sourceId), labelsById.get(edge.targetId)])).toEqual(
      expect.arrayContaining([
        ['InventoryComponent', 'InventoryComponent'],
        ['OpenInventory', 'OpenInventory'],
      ]),
    );
  });
});
