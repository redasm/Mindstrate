import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  ContextDomainType,
  ContextNodeStatus,
  ProjectGraphOverlayKind,
  ProjectGraphOverlaySource,
  SubstrateType,
} from '@mindstrate/protocol/models';
import { ContextGraphStore } from '../src/context-graph/context-graph-store.js';
import { createProjectGraphOverlay, listProjectGraphOverlays } from '../src/project-graph/overlay.js';
import { createTempDir, removeTempDir } from './test-support.js';

describe('project graph overlays', () => {
  let tempDir: string;
  let store: ContextGraphStore;

  beforeEach(() => {
    tempDir = createTempDir('mindstrate-project-graph-overlay-');
    store = new ContextGraphStore(path.join(tempDir, 'context-graph.db'));
  });

  afterEach(() => {
    store.close();
    removeTempDir(tempDir);
  });

  it('stores user graph edits as overlay nodes without mutating extracted facts', () => {
    const extracted = store.createNode({
      id: 'pg:demo:file:src/App.tsx',
      substrateType: SubstrateType.SNAPSHOT,
      domainType: ContextDomainType.ARCHITECTURE,
      title: 'src/App.tsx',
      content: 'Extracted file fact',
      project: 'demo',
      status: ContextNodeStatus.ACTIVE,
      metadata: { projectGraph: true, provenance: 'EXTRACTED' },
    });

    const overlay = createProjectGraphOverlay(store, {
      project: 'demo',
      targetNodeId: extracted.id,
      kind: ProjectGraphOverlayKind.CONFIRMATION,
      content: 'This is the app shell.',
      source: ProjectGraphOverlaySource.OBSIDIAN,
      author: 'alice',
    });

    expect(store.getNodeById(extracted.id)?.metadata?.['provenance']).toBe('EXTRACTED');
    expect(overlay.targetNodeId).toBe(extracted.id);
    expect(overlay.kind).toBe(ProjectGraphOverlayKind.CONFIRMATION);
    expect(listProjectGraphOverlays(store, { project: 'demo', targetNodeId: extracted.id })).toEqual([overlay]);
  });
});
