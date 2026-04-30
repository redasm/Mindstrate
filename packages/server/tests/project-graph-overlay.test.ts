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
import { Mindstrate } from '../src/index.js';
import {
  createProjectGraphOverlay,
  listProjectGraphOverlays,
  parseProjectGraphOverlayBlock,
  renderProjectGraphOverlayBlock,
} from '../src/project-graph/overlay.js';
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
      target: 'node:pg:demo:file:src/App.tsx',
    });

    expect(store.getNodeById(extracted.id)?.metadata?.['provenance']).toBe('EXTRACTED');
    expect(overlay.target).toBe('node:pg:demo:file:src/App.tsx');
    expect(overlay.targetNodeId).toBe(extracted.id);
    expect(overlay.kind).toBe(ProjectGraphOverlayKind.CONFIRMATION);
    expect(listProjectGraphOverlays(store, { project: 'demo', targetNodeId: extracted.id })).toEqual([overlay]);
  });

  it('exposes overlays through the context subdomain API', async () => {
    const dataDir = createTempDir('mindstrate-project-graph-overlay-runtime-');
    const memory = new Mindstrate({ dataDir });
    await memory.init();
    try {
      const overlay = memory.context.createProjectGraphOverlay({
        project: 'demo',
        targetNodeId: 'pg:demo:file:src/App.tsx',
        kind: ProjectGraphOverlayKind.NOTE,
        content: 'Read this first.',
        source: ProjectGraphOverlaySource.CLI,
      });

      expect(memory.context.listProjectGraphOverlays({
        project: 'demo',
        targetNodeId: 'pg:demo:file:src/App.tsx',
      })).toEqual([overlay]);
    } finally {
      memory.close();
      removeTempDir(dataDir);
    }
  });

  it('parses structured Obsidian overlay blocks', () => {
    const overlays = parseProjectGraphOverlayBlock(`
<!-- mindstrate:project-graph:overlay:start -->
- kind: correction
  target: node:pg:demo:file:src/App.tsx
  content: This file owns the app shell.
- kind: risk
  target: path:TypeScript/Typing
  content: Generated bindings should stay metadata-only.
<!-- mindstrate:project-graph:overlay:end -->
`);

    expect(overlays).toEqual([
      {
        kind: ProjectGraphOverlayKind.CORRECTION,
        target: 'node:pg:demo:file:src/App.tsx',
        targetNodeId: 'pg:demo:file:src/App.tsx',
        content: 'This file owns the app shell.',
      },
      {
        kind: ProjectGraphOverlayKind.RISK,
        target: 'path:TypeScript/Typing',
        content: 'Generated bindings should stay metadata-only.',
      },
    ]);
  });

  it('rejects invalid structured overlay entries', () => {
    expect(parseProjectGraphOverlayBlock(`
<!-- mindstrate:project-graph:overlay:start -->
- kind: unsupported
  content: Nope.
- kind: note
<!-- mindstrate:project-graph:overlay:end -->
`)).toEqual([]);
  });

  it('renders overlays back to a structured editable block', () => {
    expect(renderProjectGraphOverlayBlock([
      {
        id: 'overlay-1',
        project: 'demo',
        target: 'path:TypeScript/Typing',
        kind: ProjectGraphOverlayKind.CONFIRMATION,
        content: 'Human confirmed this entry point.',
        source: ProjectGraphOverlaySource.OBSIDIAN,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
    ])).toContain('target: path:TypeScript/Typing');
  });
});
