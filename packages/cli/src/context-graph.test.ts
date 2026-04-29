import test from 'node:test';
import assert from 'node:assert/strict';
import * as path from 'node:path';
import { ChangeSource, ProjectGraphOverlayKind, ProjectGraphOverlaySource, ProjectionTarget } from '@mindstrate/server';
import {
  buildGraphEvaluationDatasetExportLines,
  buildGraphOverlayLines,
  buildGraphChangeResultLines,
  buildGraphStatusLines,
  extractProjectGraphUserNotes,
  parseExternalChangeSetJson,
  resolveGraphSyncPlan,
} from './commands/context-graph.js';

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

test('resolveGraphSyncPlan prefers team mode when a team server is configured', () => {
  assert.deepEqual(resolveGraphSyncPlan({
    projectName: 'Demo App',
    config: { version: 1, mode: 'local', dataDir: '.mindstrate', vaultPath: 'vault' },
    teamServerUrl: 'http://team.example',
  }), {
    mode: 'team',
    teamServerUrl: 'http://team.example',
    obsidianFile: undefined,
  });
});

test('resolveGraphSyncPlan finds the local Obsidian project graph file', () => {
  assert.deepEqual(resolveGraphSyncPlan({
    projectName: 'Demo App',
    config: { version: 1, mode: 'local', dataDir: '.mindstrate', vaultPath: 'vault' },
  }), {
    mode: 'local',
    teamServerUrl: undefined,
    obsidianFile: path.join('vault', 'demo-app', 'architecture', 'project-graph.md'),
  });
});

test('extractProjectGraphUserNotes returns only the editable preserve block', () => {
  const notes = extractProjectGraphUserNotes([
    '<!-- mindstrate:project-graph:generated:start -->',
    'generated',
    '<!-- mindstrate:project-graph:generated:end -->',
    '## User Notes',
    '<!-- mindstrate:project-graph:user-notes:start -->',
    '- src/App.tsx is intentionally thin.',
    '<!-- mindstrate:project-graph:user-notes:end -->',
  ].join('\n'));

  assert.equal(notes, '- src/App.tsx is intentionally thin.');
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

test('parseExternalChangeSetJson normalizes collector changeset payloads', () => {
  const changeSet = parseExternalChangeSetJson(JSON.stringify({
    source: ChangeSource.P4,
    base: '100',
    head: '101',
    files: [
      {
        path: 'Source\\Client\\Client.Build.cs',
        status: 'renamed',
        oldPath: 'Source\\OldClient\\Client.Build.cs',
        language: 'csharp',
        layerId: 'gameplay-cpp',
      },
    ],
  }));

  assert.deepEqual(changeSet, {
    source: ChangeSource.P4,
    base: '100',
    head: '101',
    files: [
      {
        path: 'Source/Client/Client.Build.cs',
        status: 'renamed',
        oldPath: 'Source/OldClient/Client.Build.cs',
        language: 'csharp',
        layerId: 'gameplay-cpp',
      },
    ],
  });
});

test('buildGraphChangeResultLines renders external changeset analysis', () => {
  const lines = buildGraphChangeResultLines({
    changeSet: {
      source: ChangeSource.P4,
      files: [{ path: 'src/App.tsx', status: 'modified', layerId: 'ui' }],
    },
    affectedNodeIds: ['node-1'],
    affectedLayers: ['ui'],
    riskHints: ['Review generated files.'],
    suggestedQueries: ['mindstrate graph context src/App.tsx'],
  });

  assert.deepEqual(lines, [
    'Source: p4',
    'Files: 1',
    'Affected nodes: 1',
    'Affected layers: ui',
    '',
    'Risk hints:',
    '  - Review generated files.',
    '',
    'Suggested queries:',
    '  - mindstrate graph context src/App.tsx',
  ]);
});

test('buildGraphEvaluationDatasetExportLines renders published dataset locations', () => {
  const lines = buildGraphEvaluationDatasetExportLines({
    reportPath: path.join('out', 'project-graph-evaluation-dataset.md'),
    fixturesDir: path.join('out', 'fixtures'),
    fixtureCount: 5,
    taskCount: 5,
  });

  assert.deepEqual(lines, [
    'Project graph evaluation dataset exported',
    `  Report: ${path.join('out', 'project-graph-evaluation-dataset.md')}`,
    `  Fixtures: ${path.join('out', 'fixtures')}`,
    '  Fixture count: 5',
    '  Task count: 5',
  ]);
});
