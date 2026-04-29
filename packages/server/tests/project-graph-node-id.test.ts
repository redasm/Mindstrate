import { describe, expect, it } from 'vitest';
import { ProjectGraphNodeKind, ProjectGraphEdgeKind } from '@mindstrate/protocol/models';
import {
  createProjectGraphEdgeId,
  createProjectGraphNodeId,
} from '../src/project-graph/node-id.js';

describe('project graph stable IDs', () => {
  it('normalizes path separators and casing noise for file-backed node IDs', () => {
    expect(createProjectGraphNodeId({
      project: 'Demo App',
      kind: ProjectGraphNodeKind.FILE,
      key: 'src\\Features\\Auth\\Session.ts',
    })).toBe(createProjectGraphNodeId({
      project: 'Demo App',
      kind: ProjectGraphNodeKind.FILE,
      key: 'src/Features/Auth/Session.ts',
    }));
  });

  it('keeps different projects isolated even when node keys match', () => {
    const left = createProjectGraphNodeId({
      project: 'client',
      kind: ProjectGraphNodeKind.MODULE,
      key: 'src/auth/session.ts',
    });
    const right = createProjectGraphNodeId({
      project: 'server',
      kind: ProjectGraphNodeKind.MODULE,
      key: 'src/auth/session.ts',
    });

    expect(left).not.toBe(right);
  });

  it('creates stable edge IDs from source, target, and relation kind', () => {
    const sourceId = createProjectGraphNodeId({
      project: 'demo',
      kind: ProjectGraphNodeKind.FILE,
      key: 'src/app.tsx',
    });
    const targetId = createProjectGraphNodeId({
      project: 'demo',
      kind: ProjectGraphNodeKind.DEPENDENCY,
      key: 'react',
    });

    expect(createProjectGraphEdgeId({
      sourceId,
      targetId,
      kind: ProjectGraphEdgeKind.DEPENDS_ON,
    })).toBe(createProjectGraphEdgeId({
      sourceId,
      targetId,
      kind: ProjectGraphEdgeKind.DEPENDS_ON,
    }));
  });
});
