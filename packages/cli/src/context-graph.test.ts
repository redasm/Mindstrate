import test from 'node:test';
import assert from 'node:assert/strict';
import { ProjectGraphOverlayKind, ProjectGraphOverlaySource, ProjectionTarget } from '@mindstrate/server';
import { buildGraphOverlayLines, buildGraphStatusLines } from './commands/context-graph.js';

test('buildGraphStatusLines shows local canonical graph and projection targets', () => {
  const lines = buildGraphStatusLines({
    mode: 'local',
    project: 'demo',
    nodes: 3,
    edges: 2,
    projections: [
      {
        id: 'p1',
        nodeId: 'n1',
        target: ProjectionTarget.PROJECT_GRAPH_OBSIDIAN,
        targetRef: 'vault/demo/architecture/project-graph.md',
        version: 1,
        projectedAt: '2026-01-01T00:00:00.000Z',
      },
    ],
  });

  assert.deepEqual(lines, [
    'Project graph status',
    '  Project: demo',
    '  Canonical: local ECS graph',
    '  Nodes: 3',
    '  Edges: 2',
    '  Projections:',
    '    - project_graph_obsidian: vault/demo/architecture/project-graph.md',
  ]);
});

test('buildGraphOverlayLines renders editable project graph overlays', () => {
  const lines = buildGraphOverlayLines([
    {
      id: 'overlay-1',
      project: 'demo',
      targetNodeId: 'pg:demo:file:src/App.tsx',
      kind: ProjectGraphOverlayKind.CORRECTION,
      content: 'This is a route shell, not a domain component.',
      author: 'yangfan',
      source: ProjectGraphOverlaySource.OBSIDIAN,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    },
  ]);

  assert.deepEqual(lines, [
    'Overlays: 1',
    '  - [correction] This is a route shell, not a domain component.',
    '    Source: obsidian | Author: yangfan | ID: overlay-1',
  ]);
});
