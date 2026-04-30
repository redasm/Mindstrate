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

    const project = detectProject(root);
    expect(project).not.toBeNull();
    indexProjectGraph(store, project!);

    const nodes = store.listNodes({ project: 'Client', limit: 100 });
    const projectNode = nodes.find((node) => node.metadata?.[PROJECT_GRAPH_METADATA_KEYS.kind] === ProjectGraphNodeKind.PROJECT);
    const sourceNode = nodes.find((node) => node.title === 'Source');
    const contentNode = nodes.find((node) => node.title === 'Content');
    const generatedNode = nodes.find((node) => node.title === 'TypeScript/Typing/ue/generated');
    const generatedFile = nodes.find((node) => node.title.endsWith('Actor.d.ts'));

    expect(projectNode).toBeDefined();
    expect(sourceNode?.metadata).toMatchObject({ scanMode: 'deep' });
    expect(contentNode?.metadata).toMatchObject({ scanMode: 'metadata-only' });
    expect(generatedNode?.metadata).toMatchObject({ scanMode: 'generated' });
    expect(generatedFile).toBeUndefined();
    expect(store.listEdges({ limit: 100 }).filter((edge) =>
      edge.evidence?.[PROJECT_GRAPH_METADATA_KEYS.kind] === ProjectGraphEdgeKind.CONTAINS
    ).length).toBeGreaterThanOrEqual(3);
  });
});
