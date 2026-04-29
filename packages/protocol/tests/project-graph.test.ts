import { describe, expect, it } from 'vitest';
import {
  ProjectGraphEdgeKind,
  ProjectGraphNodeKind,
  ProjectGraphProvenance,
  ChangeSource,
  type EvidenceRef,
  type ProjectGraphNodeDto,
  type ProjectLayer,
} from '../src/models/project-graph.js';

describe('project graph protocol model', () => {
  it('keeps project graph enum values stable', () => {
    expect(Object.values(ProjectGraphNodeKind)).toEqual([
      'project',
      'directory',
      'file',
      'module',
      'component',
      'route',
      'config',
      'script',
      'dependency',
      'function',
      'class',
      'type',
      'concept',
      'decision',
      'constraint',
      'risk',
    ]);
    expect(Object.values(ProjectGraphEdgeKind)).toEqual([
      'contains',
      'imports',
      'exports',
      'depends_on',
      'defines',
      'configures',
      'routes_to',
      'renders',
      'calls',
      'uses_hook',
      'documents',
      'constrains',
      'rationale_for',
      'related_to',
    ]);
    expect(Object.values(ProjectGraphProvenance)).toEqual([
      'EXTRACTED',
      'INFERRED',
      'AMBIGUOUS',
    ]);
    expect(Object.values(ChangeSource)).toEqual([
      'git',
      'p4',
      'filesystem',
      'manual',
    ]);
  });

  it('describes parser evidence and project layers without runtime dependencies', () => {
    const evidence: EvidenceRef = {
      path: 'src/App.tsx',
      startLine: 3,
      endLine: 7,
      extractorId: 'tree-sitter-tsx:react-components',
      captureName: 'component.declaration',
    };
    const node: ProjectGraphNodeDto = {
      id: 'pg:demo:file:src/App.tsx',
      kind: ProjectGraphNodeKind.FILE,
      label: 'src/App.tsx',
      project: 'demo',
      provenance: ProjectGraphProvenance.EXTRACTED,
      evidence: [evidence],
      metadata: { language: 'tsx' },
    };
    const layer: ProjectLayer = {
      id: 'web-ui',
      label: 'Web UI',
      roots: ['src'],
      language: 'typescript',
      parserAdapters: ['tree-sitter-source'],
      queryPacks: ['typescript', 'tsx', 'react'],
      conventionExtractors: ['vite-entry'],
      changeAdapters: [ChangeSource.GIT, ChangeSource.FILESYSTEM],
    };

    expect(node.evidence[0]).toEqual(evidence);
    expect(layer.queryPacks).toContain('react');
  });
});
