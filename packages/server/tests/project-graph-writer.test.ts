import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  ContextNodeStatus,
  ProjectGraphEdgeKind,
  ProjectGraphNodeKind,
  ProjectGraphProvenance,
} from '@mindstrate/protocol/models';
import { ContextGraphStore } from '../src/context-graph/context-graph-store.js';
import {
  archiveProjectGraphFileFacts,
  writeProjectGraphExtraction,
  type ProjectGraphExtractionResult,
} from '../src/project-graph/graph-writer.js';
import { createTempDir, removeTempDir } from './test-support.js';

describe('project graph ECS writer', () => {
  let tempDir: string;
  let store: ContextGraphStore;

  beforeEach(() => {
    tempDir = createTempDir('mindstrate-project-graph-writer-');
    store = new ContextGraphStore(path.join(tempDir, 'context-graph.db'));
  });

  afterEach(() => {
    store.close();
    removeTempDir(tempDir);
  });

  it('upserts extracted graph nodes and avoids duplicate edges', () => {
    const extraction = makeExtraction();

    expect(writeProjectGraphExtraction(store, extraction)).toEqual({
      nodesCreated: 2,
      nodesUpdated: 0,
      edgesCreated: 1,
      edgesSkipped: 0,
    });
    expect(writeProjectGraphExtraction(store, extraction)).toEqual({
      nodesCreated: 0,
      nodesUpdated: 2,
      edgesCreated: 0,
      edgesSkipped: 1,
    });

    const nodes = store.listNodes({ project: 'demo', limit: 10 });
    const edges = store.listEdges({ limit: 10 });
    const fileNode = store.getNodeById('pg:demo:file:src/App.tsx')!;

    expect(nodes).toHaveLength(2);
    expect(edges).toHaveLength(1);
    expect(fileNode.status).toBe(ContextNodeStatus.ACTIVE);
    expect(fileNode.confidence).toBeGreaterThanOrEqual(0.85);
    expect(fileNode.qualityScore).toBeGreaterThanOrEqual(60);
    expect(fileNode.metadata).toMatchObject({
      projectGraph: true,
      kind: ProjectGraphNodeKind.FILE,
      provenance: ProjectGraphProvenance.EXTRACTED,
      ownedByFile: 'src/App.tsx',
    });
    expect(edges[0].evidence).toMatchObject({
      projectGraph: true,
      kind: ProjectGraphEdgeKind.DEFINES,
      provenance: ProjectGraphProvenance.EXTRACTED,
    });
  });

  it('scores ambiguous inferred facts lower than exact parser facts', () => {
    writeProjectGraphExtraction(store, {
      project: 'demo',
      nodes: [
        {
          id: 'pg:demo:concept:unclear',
          kind: ProjectGraphNodeKind.CONCEPT,
          label: 'Unclear ownership',
          project: 'demo',
          provenance: ProjectGraphProvenance.AMBIGUOUS,
          evidence: [{ path: 'src/App.tsx', extractorId: 'llm-enrichment' }],
        },
      ],
      edges: [],
    });

    const node = store.getNodeById('pg:demo:concept:unclear')!;
    expect(node.confidence).toBeLessThan(0.7);
    expect(node.qualityScore).toBeLessThan(70);
  });

  it('archives facts owned by a deleted file', () => {
    writeProjectGraphExtraction(store, makeExtraction());

    const archived = archiveProjectGraphFileFacts(store, {
      project: 'demo',
      filePath: 'src/App.tsx',
    });

    expect(archived).toBe(2);
    expect(store.getNodeById('pg:demo:file:src/App.tsx')?.status).toBe(ContextNodeStatus.ARCHIVED);
    expect(store.getNodeById('pg:demo:function:src/App.tsx#App')?.status).toBe(ContextNodeStatus.ARCHIVED);
  });
});

const makeExtraction = (): ProjectGraphExtractionResult => ({
  project: 'demo',
  nodes: [
    {
      id: 'pg:demo:file:src/App.tsx',
      kind: ProjectGraphNodeKind.FILE,
      label: 'src/App.tsx',
      project: 'demo',
      provenance: ProjectGraphProvenance.EXTRACTED,
      evidence: [{ path: 'src/App.tsx', extractorId: 'tree-sitter-source' }],
      metadata: { ownedByFile: 'src/App.tsx' },
    },
    {
      id: 'pg:demo:function:src/App.tsx#App',
      kind: ProjectGraphNodeKind.FUNCTION,
      label: 'App',
      project: 'demo',
      provenance: ProjectGraphProvenance.EXTRACTED,
      evidence: [{ path: 'src/App.tsx', startLine: 1, endLine: 3, extractorId: 'tree-sitter-source' }],
      metadata: { ownedByFile: 'src/App.tsx' },
    },
  ],
  edges: [
    {
      id: 'pge:defines:file-app:function-app',
      sourceId: 'pg:demo:file:src/App.tsx',
      targetId: 'pg:demo:function:src/App.tsx#App',
      kind: ProjectGraphEdgeKind.DEFINES,
      provenance: ProjectGraphProvenance.EXTRACTED,
      evidence: [{ path: 'src/App.tsx', startLine: 1, endLine: 3, extractorId: 'tree-sitter-source' }],
    },
  ],
});
