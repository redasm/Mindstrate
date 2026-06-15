import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  PROJECT_GRAPH_METADATA_KEYS,
  ProjectGraphEdgeKind,
  ProjectGraphNodeKind,
  ProjectGraphProvenance,
  type ProjectGraphNodeDto,
} from '@mindstrate/protocol/models';
import { ContextGraphStore } from '../src/context-graph/context-graph-store.js';
import { writeProjectGraphExtraction } from '../src/project-graph/graph-writer.js';
import { bindProjectGraph } from '../src/project-graph/project-graph-binding.js';
import { createTempDir, removeTempDir } from './test-support.js';

const pgNode = (
  id: string,
  kind: ProjectGraphNodeKind,
  label: string,
  metadata?: Record<string, unknown>,
): ProjectGraphNodeDto => ({
  id,
  kind,
  label,
  project: 'demo',
  provenance: ProjectGraphProvenance.EXTRACTED,
  evidence: [{ path: `${label}.src`, extractorId: 'tree-sitter-source' }],
  metadata,
});

const edgesOfKind = (store: ContextGraphStore, kind: ProjectGraphEdgeKind) =>
  store.listEdges({ limit: 500 }).filter(
    (edge) => edge.evidence?.[PROJECT_GRAPH_METADATA_KEYS.kind] === kind,
  );

describe('project graph SQL binding', () => {
  let tempDir: string;
  let store: ContextGraphStore;

  beforeEach(() => {
    tempDir = createTempDir('mindstrate-project-graph-binding-');
    store = new ContextGraphStore(path.join(tempDir, 'context-graph.db'));
  });

  afterEach(() => {
    store.close();
    removeTempDir(tempDir);
  });

  it('binds native symbols to dependencies with the same normalized name', () => {
    writeProjectGraphExtraction(store, {
      project: 'demo',
      nodes: [
        pgNode('n:class:inv', ProjectGraphNodeKind.CLASS, 'InventoryComponent'),
        pgNode('n:fn:open', ProjectGraphNodeKind.FUNCTION, 'OpenInventory'),
        pgNode('n:dep:inv', ProjectGraphNodeKind.DEPENDENCY, 'InventoryComponent'),
        pgNode('n:dep:open', ProjectGraphNodeKind.DEPENDENCY, 'OpenInventory'),
        pgNode('n:dep:other', ProjectGraphNodeKind.DEPENDENCY, 'Unrelated'),
      ],
      edges: [],
    });

    const result = bindProjectGraph(store, 'demo');
    expect(result.edgesCreated).toBe(2);

    const binds = edgesOfKind(store, ProjectGraphEdgeKind.BINDS_TO)
      .map((edge) => [edge.sourceId, edge.targetId]);
    expect(binds).toEqual(
      expect.arrayContaining([
        ['n:class:inv', 'n:dep:inv'],
        ['n:fn:open', 'n:dep:open'],
      ]),
    );
    expect(binds).toHaveLength(2);
  });

  it('strips a leading U so native UClass binds to its script symbol', () => {
    writeProjectGraphExtraction(store, {
      project: 'demo',
      nodes: [
        pgNode('n:class:uinv', ProjectGraphNodeKind.CLASS, 'UInventoryComponent'),
        pgNode('n:dep:inv', ProjectGraphNodeKind.DEPENDENCY, 'InventoryComponent'),
      ],
      edges: [],
    });

    bindProjectGraph(store, 'demo');

    const binds = edgesOfKind(store, ProjectGraphEdgeKind.BINDS_TO);
    expect(binds.map((edge) => [edge.sourceId, edge.targetId])).toEqual([
      ['n:class:uinv', 'n:dep:inv'],
    ]);
  });

  it('is idempotent across re-runs (no duplicate binding edges)', () => {
    writeProjectGraphExtraction(store, {
      project: 'demo',
      nodes: [
        pgNode('n:class:inv', ProjectGraphNodeKind.CLASS, 'InventoryComponent'),
        pgNode('n:dep:inv', ProjectGraphNodeKind.DEPENDENCY, 'InventoryComponent'),
      ],
      edges: [],
    });

    const first = bindProjectGraph(store, 'demo');
    expect(first.edgesCreated).toBe(1);

    const second = bindProjectGraph(store, 'demo');
    expect(second.edgesCreated).toBe(0);
    expect(second.edgesSkipped).toBe(1);
    expect(edgesOfKind(store, ProjectGraphEdgeKind.BINDS_TO)).toHaveLength(1);
  });

  it('links a generated file to its source symbol and stamps sourceGeneratedFrom', () => {
    writeProjectGraphExtraction(store, {
      project: 'demo',
      nodes: [
        pgNode('n:class:inv', ProjectGraphNodeKind.CLASS, 'InventoryComponent'),
        pgNode(
          'n:file:gen',
          ProjectGraphNodeKind.FILE,
          'TypeScript/Typing/InventoryComponent.ts',
          { generated: true },
        ),
      ],
      edges: [],
    });

    bindProjectGraph(store, 'demo');

    const generatedEdges = edgesOfKind(store, ProjectGraphEdgeKind.GENERATED_FROM);
    expect(generatedEdges.map((edge) => [edge.sourceId, edge.targetId])).toEqual([
      ['n:file:gen', 'n:class:inv'],
    ]);
    expect(store.getNodeById('n:file:gen')?.metadata?.['sourceGeneratedFrom']).toBe('n:class:inv');
  });

  it('picks the lowest-id symbol when several share a generated name', () => {
    writeProjectGraphExtraction(store, {
      project: 'demo',
      nodes: [
        pgNode('n:class:b', ProjectGraphNodeKind.CLASS, 'Widget'),
        pgNode('n:class:a', ProjectGraphNodeKind.CLASS, 'Widget'),
        pgNode('n:file:gen', ProjectGraphNodeKind.FILE, 'gen/Widget.ts', { generated: true }),
      ],
      edges: [],
    });

    bindProjectGraph(store, 'demo');

    expect(store.getNodeById('n:file:gen')?.metadata?.['sourceGeneratedFrom']).toBe('n:class:a');
  });
});
