import * as fs from 'node:fs';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ContextGraphStore } from '../src/context-graph/context-graph-store.js';
import { detectProject } from '../src/project/detector.js';
import { indexProjectGraph } from '../src/project-graph/project-graph-service.js';
import { collectProjectGraphViews } from '../src/project-graph/views.js';
import { createTempDir, removeTempDir } from './test-support.js';

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
      assets: [{ path: '/Game/UI/WBP_MainMenu', class: 'WidgetBlueprint', references: [] }],
    }));

    const project = detectProject(root);
    expect(project).not.toBeNull();
    indexProjectGraph(store, project!);

    expect(collectProjectGraphViews(store, 'Client')).toMatchObject({
      dependencies: expect.arrayContaining(['InventoryComponent']),
      assets: ['/Game/UI/WBP_MainMenu'],
      bindings: expect.arrayContaining([{ native: 'InventoryComponent', script: 'InventoryComponent' }]),
    });
  });
});
