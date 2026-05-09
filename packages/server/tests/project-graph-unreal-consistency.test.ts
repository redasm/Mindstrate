import * as fs from 'node:fs';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ContextGraphStore } from '../src/context-graph/context-graph-store.js';
import { detectProject } from '../src/project/detector.js';
import { indexProjectGraph } from '../src/project-graph/project-graph-service.js';
import {
  checkUnrealModuleBoundaryConsistency,
  checkUnrealPluginDependencyConsistency,
} from '../src/project-graph/unreal-consistency.js';
import { createTempDir, removeTempDir } from './test-support.js';

const write = (root: string, rel: string, content: string): void => {
  const abs = path.join(root, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content, 'utf8');
};

describe('Unreal project graph consistency checks', () => {
  let root: string;
  let store: ContextGraphStore;

  beforeEach(() => {
    root = createTempDir('mindstrate-project-graph-unreal-consistency-');
    store = new ContextGraphStore(path.join(root, '.mindstrate', 'context-graph.db'));
  });

  afterEach(() => {
    store.close();
    removeTempDir(root);
  });

  it('flags plugin Build.cs module dependencies missing from the owning .uplugin', () => {
    materializeUnrealPluginProject(false);

    const project = detectProject(root);
    expect(project).not.toBeNull();
    indexProjectGraph(store, project!);

    const issues = checkUnrealPluginDependencyConsistency({
      nodes: store.listNodes({ project: 'Client', limit: 200 }),
      edges: store.listEdges({ limit: 200 }),
    });

    expect(issues).toEqual([
      expect.objectContaining({
        code: 'missing-plugin-dependency',
        plugin: 'Inventory',
        pluginManifest: 'Plugins/Inventory/Inventory.uplugin',
        module: 'Inventory',
        moduleFile: 'Plugins/Inventory/Source/Inventory/Inventory.Build.cs',
        dependencyModule: 'GameplayAbilities',
        requiredPlugin: 'GameplayAbilities',
      }),
    ]);
    expect(issues[0]?.message).toContain('Inventory.uplugin does not declare plugin dependency GameplayAbilities');
  });

  it('accepts plugin module dependencies declared in the owning .uplugin', () => {
    materializeUnrealPluginProject(true);

    const project = detectProject(root);
    expect(project).not.toBeNull();
    indexProjectGraph(store, project!);

    const issues = checkUnrealPluginDependencyConsistency({
      nodes: store.listNodes({ project: 'Client', limit: 200 }),
      edges: store.listEdges({ limit: 200 }),
    });

    expect(issues).toEqual([]);
  });

  it('flags runtime modules depending on editor-only modules', () => {
    materializeUnrealModuleBoundaryProject('Runtime');

    const project = detectProject(root);
    expect(project).not.toBeNull();
    indexProjectGraph(store, project!);

    const issues = checkUnrealModuleBoundaryConsistency({
      nodes: store.listNodes({ project: 'Client', limit: 200 }),
      edges: store.listEdges({ limit: 200 }),
    });

    expect(issues).toEqual([
      expect.objectContaining({
        code: 'runtime-depends-on-editor-module',
        module: 'Inventory',
        moduleType: 'Runtime',
        moduleFile: 'Plugins/Inventory/Source/Inventory/Inventory.Build.cs',
        dependencyModule: 'InventoryEditor',
        dependencyModuleType: 'Editor',
        dependencyModuleFile: 'Plugins/Inventory/Inventory.uplugin',
      }),
    ]);
    expect(issues[0]?.message).toContain('Runtime modules must not depend on Editor modules');
  });

  it('accepts editor modules depending on editor-only modules', () => {
    materializeUnrealModuleBoundaryProject('Editor');

    const project = detectProject(root);
    expect(project).not.toBeNull();
    indexProjectGraph(store, project!);

    const issues = checkUnrealModuleBoundaryConsistency({
      nodes: store.listNodes({ project: 'Client', limit: 200 }),
      edges: store.listEdges({ limit: 200 }),
    });

    expect(issues).toEqual([]);
  });

  const materializeUnrealPluginProject = (declarePluginDependency: boolean): void => {
    write(root, 'Client.uproject', JSON.stringify({ FileVersion: 3 }));
    write(root, 'Config/DefaultGame.ini', '[/Script/EngineSettings.GeneralProjectSettings]');
    fs.mkdirSync(path.join(root, 'Content'), { recursive: true });
    write(root, 'Plugins/Inventory/Inventory.uplugin', JSON.stringify({
      FileVersion: 3,
      Modules: [{ Name: 'Inventory', Type: 'Runtime', LoadingPhase: 'Default' }],
      Plugins: declarePluginDependency ? [{ Name: 'GameplayAbilities', Enabled: true }] : [],
    }));
    write(root, 'Plugins/Inventory/Source/Inventory/Inventory.Build.cs', `
      public class Inventory : ModuleRules {
        public Inventory(ReadOnlyTargetRules Target) : base(Target) {
          PublicDependencyModuleNames.AddRange(new string[] { "Core", "GameplayAbilities" });
        }
      }
    `);
    write(root, 'Plugins/GameplayAbilities/GameplayAbilities.uplugin', JSON.stringify({
      FileVersion: 3,
      Modules: [{ Name: 'GameplayAbilities', Type: 'Runtime', LoadingPhase: 'Default' }],
    }));
  };

  const materializeUnrealModuleBoundaryProject = (sourceModuleType: 'Runtime' | 'Editor'): void => {
    write(root, 'Client.uproject', JSON.stringify({ FileVersion: 3 }));
    write(root, 'Config/DefaultGame.ini', '[/Script/EngineSettings.GeneralProjectSettings]');
    fs.mkdirSync(path.join(root, 'Content'), { recursive: true });
    write(root, 'Plugins/Inventory/Inventory.uplugin', JSON.stringify({
      FileVersion: 3,
      Modules: [
        { Name: 'Inventory', Type: sourceModuleType, LoadingPhase: 'Default' },
        { Name: 'InventoryEditor', Type: 'Editor', LoadingPhase: 'Default' },
      ],
    }));
    write(root, 'Plugins/Inventory/Source/Inventory/Inventory.Build.cs', `
      public class Inventory : ModuleRules {
        public Inventory(ReadOnlyTargetRules Target) : base(Target) {
          PublicDependencyModuleNames.AddRange(new string[] { "Core", "InventoryEditor" });
        }
      }
    `);
  };
});
