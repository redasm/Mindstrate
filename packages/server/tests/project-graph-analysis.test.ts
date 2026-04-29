import { describe, expect, it } from 'vitest';
import {
  ContextDomainType,
  ContextRelationType,
  ContextNodeStatus,
  ProjectGraphEdgeKind,
  ProjectGraphNodeKind,
  ProjectGraphProvenance,
  SubstrateType,
  type ContextEdge,
  type ContextNode,
} from '@mindstrate/protocol/models';
import {
  estimateProjectGraphBlastRadius,
  findProjectGraphPath,
} from '../src/project-graph/analysis.js';

describe('project graph analysis queries', () => {
  it('finds a bounded shortest path between project graph nodes', () => {
    const result = findProjectGraphPath({
      nodes: [
        node('pg:demo:file:src/App.tsx', 'src/App.tsx', ProjectGraphNodeKind.FILE),
        node('pg:demo:component:src/App.tsx#App', 'App', ProjectGraphNodeKind.COMPONENT),
        node('pg:demo:dependency:react', 'react', ProjectGraphNodeKind.DEPENDENCY),
      ],
      edges: [
        edge('e1', 'pg:demo:file:src/App.tsx', 'pg:demo:component:src/App.tsx#App', ProjectGraphEdgeKind.DEFINES),
        edge('e2', 'pg:demo:component:src/App.tsx#App', 'pg:demo:dependency:react', ProjectGraphEdgeKind.DEPENDS_ON),
      ],
      from: 'src/App.tsx',
      to: 'react',
      maxDepth: 3,
    });

    expect(result.found).toBe(true);
    expect(result.nodes.map((entry) => entry.title)).toEqual(['src/App.tsx', 'App', 'react']);
    expect(result.edges.map((entry) => entry.id)).toEqual(['e1', 'e2']);
  });

  it('estimates blast radius from local project graph neighbors', () => {
    const result = estimateProjectGraphBlastRadius({
      nodes: [
        node('pg:demo:file:src/shared.ts', 'src/shared.ts', ProjectGraphNodeKind.FILE),
        node('pg:demo:file:src/App.tsx', 'src/App.tsx', ProjectGraphNodeKind.FILE),
        node('pg:demo:file:src/Admin.tsx', 'src/Admin.tsx', ProjectGraphNodeKind.FILE),
      ],
      edges: [
        edge('e1', 'pg:demo:file:src/App.tsx', 'pg:demo:file:src/shared.ts', ProjectGraphEdgeKind.IMPORTS),
        edge('e2', 'pg:demo:file:src/Admin.tsx', 'pg:demo:file:src/shared.ts', ProjectGraphEdgeKind.IMPORTS),
      ],
      id: 'src/shared.ts',
      depth: 1,
      limit: 10,
    });

    expect(result.root?.title).toBe('src/shared.ts');
    expect(result.affectedNodes.map((entry) => entry.title).sort()).toEqual(['src/Admin.tsx', 'src/App.tsx']);
    expect(result.edges.map((entry) => entry.id).sort()).toEqual(['e1', 'e2']);
  });
});

const node = (
  id: string,
  title: string,
  kind: ProjectGraphNodeKind,
): ContextNode => ({
  id,
  substrateType: SubstrateType.SNAPSHOT,
  domainType: ContextDomainType.ARCHITECTURE,
  title,
  content: title,
  tags: ['project-graph'],
  project: 'demo',
  compressionLevel: 0,
  confidence: 1,
  qualityScore: 80,
  status: ContextNodeStatus.ACTIVE,
  sourceRef: title.includes('/') ? title : undefined,
  metadata: {
    projectGraph: true,
    kind,
    provenance: ProjectGraphProvenance.EXTRACTED,
    evidence: [{ path: title, extractorId: 'test' }],
  },
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  accessCount: 0,
  positiveFeedback: 0,
  negativeFeedback: 0,
});

const edge = (
  id: string,
  sourceId: string,
  targetId: string,
  kind: ProjectGraphEdgeKind,
): ContextEdge => ({
  id,
  sourceId,
  targetId,
  relationType: ContextRelationType.DEPENDS_ON,
  strength: 1,
  evidence: {
    projectGraph: true,
    kind,
    provenance: ProjectGraphProvenance.EXTRACTED,
  },
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
});
