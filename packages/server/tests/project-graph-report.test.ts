import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  ContextDomainType,
  ContextNodeStatus,
  ProjectGraphNodeKind,
  ProjectGraphProvenance,
  ProjectionTarget,
  SubstrateType,
} from '@mindstrate/protocol/models';
import { Mindstrate, detectProject, writeProjectGraphTextFileAtomically } from '../src/index.js';
import { createTempDir, removeTempDir } from './test-support.js';

const write = (root: string, rel: string, content: string): void => {
  const abs = path.join(root, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content, 'utf8');
};

describe('project graph report export', () => {
  let root: string;
  let dataDir: string;
  let memory: Mindstrate;

  beforeEach(async () => {
    root = createTempDir('mindstrate-project-graph-report-');
    dataDir = createTempDir('mindstrate-project-graph-report-data-');
    memory = new Mindstrate({ dataDir });
    await memory.init();
  });

  afterEach(() => {
    memory.close();
    removeTempDir(root);
    removeTempDir(dataDir);
  });

  it('writes a lightweight repo entry and machine stats next to the project', () => {
    write(root, 'package.json', JSON.stringify({
      name: 'demo-report',
      dependencies: { react: '^19.0.0' },
    }));
    write(root, 'src/App.tsx', 'export function App() { return <main />; }');

    const project = detectProject(root)!;
    memory.context.indexProjectGraph(project);
    const result = memory.context.writeProjectGraphArtifacts(project);

    const report = fs.readFileSync(path.join(root, 'PROJECT_GRAPH.md'), 'utf8');
    const stats = JSON.parse(fs.readFileSync(path.join(root, '.mindstrate', 'project-graph.json'), 'utf8')) as {
      project: string;
      nodes: number;
      edges: number;
      firstFiles: string[];
      provenanceCounts: Record<string, number>;
    };
    const graph = JSON.parse(fs.readFileSync(path.join(root, '.mindstrate', 'project-graph.graph.json'), 'utf8')) as {
      schemaVersion: number;
      project: string;
      nodes: Array<{
        id: string;
        kind: string;
        label: string;
        project: string;
        confidence: number;
        salience: number;
        evidence: Array<{ path: string; extractorId: string; locationUnavailable?: boolean; startLine?: number }>;
      }>;
      edges: Array<{
        id: string;
        sourceId: string;
        targetId: string;
        kind: string;
        relationType: string;
        confidence: number;
        evidence: Array<{ path: string; extractorId: string; locationUnavailable?: boolean }>;
      }>;
      stats: { nodes: number; edges: number };
    };

    expect(result.reportPath).toBe(path.join(root, 'PROJECT_GRAPH.md'));
    expect(report).toContain('# PROJECT_GRAPH.md');
    expect(report).toContain('Canonical project graph facts live in Mindstrate ECS.');
    expect(report).not.toContain('## User Notes');
    expect(report).toContain('mindstrate graph context src/App.tsx');
    expect(report).toContain('mindstrate graph query "entry points"');
    expect(stats.project).toBe('demo-report');
    expect(stats.nodes).toBeGreaterThan(0);
    expect(stats.edges).toBeGreaterThan(0);
    expect(stats.firstFiles).toContain('src/App.tsx');
    expect(stats.provenanceCounts.EXTRACTED).toBeGreaterThan(0);
    expect(graph.schemaVersion).toBe(1);
    expect(graph.project).toBe('demo-report');
    expect(graph.stats.nodes).toBe(stats.nodes);
    expect(graph.stats.edges).toBe(stats.edges);
    expect(graph.nodes.length).toBe(stats.nodes);
    expect(graph.edges.length).toBe(stats.edges);
    expect(graph.nodes.find((node) => node.label === 'src/App.tsx')).toEqual(expect.objectContaining({
      kind: ProjectGraphNodeKind.FILE,
      project: 'demo-report',
      confidence: expect.any(Number),
      salience: expect.any(Number),
      evidence: expect.arrayContaining([
        expect.objectContaining({ path: 'src/App.tsx', locationUnavailable: true }),
      ]),
    }));
    expect(graph.nodes.find((node) => node.label === 'App')?.evidence[0]).toEqual(expect.objectContaining({
      path: 'src/App.tsx',
      startLine: 1,
      locationUnavailable: false,
    }));
    expect(graph.edges[0]).toEqual(expect.objectContaining({
      sourceId: expect.any(String),
      targetId: expect.any(String),
      kind: expect.any(String),
      relationType: expect.any(String),
      confidence: expect.any(Number),
      evidence: expect.any(Array),
    }));
    const records = memory.projections.listProjectionRecords({
      target: ProjectionTarget.PROJECT_GRAPH_REPO_ENTRY,
      limit: 10,
    });
    expect(records[0].targetRef).toBe(result.reportPath);
  });

  it('ranks entry and source files before incidental root files', () => {
    write(root, 'package.json', JSON.stringify({ name: 'ranking-demo' }));
    write(root, 'README.md', '# Ranking demo');
    write(root, 'src/App.tsx', 'export function App() { return <main />; }');
    write(root, 'src/index.tsx', 'import { App } from "./App";\nexport function bootstrap() { return App; }');

    const project = detectProject(root)!;
    memory.context.indexProjectGraph(project);
    memory.context.writeProjectGraphArtifacts(project);

    const stats = JSON.parse(fs.readFileSync(path.join(root, '.mindstrate', 'project-graph.json'), 'utf8')) as {
      firstFiles: string[];
    };
    const report = fs.readFileSync(path.join(root, 'PROJECT_GRAPH.md'), 'utf8');

    expect(stats.firstFiles.slice(0, 3)).toEqual(['src/index.tsx', 'src/App.tsx', 'package.json']);
    expect(report).toContain('- mindstrate graph context src/index.tsx');
  });

  it('writes an editable Obsidian project graph projection', () => {
    write(root, 'package.json', JSON.stringify({
      name: 'demo-report',
      dependencies: { react: '^19.0.0' },
    }));
    write(root, 'src/App.tsx', 'export function App() { return <main />; }');
    const vaultRoot = createTempDir('mindstrate-project-graph-vault-');

    try {
      const project = detectProject(root)!;
      memory.context.indexProjectGraph(project);
      memory.context.createContextNode({
        id: 'pg:demo-report:concept:app-shell',
        substrateType: SubstrateType.SNAPSHOT,
        domainType: ContextDomainType.ARCHITECTURE,
        title: 'Application shell',
        content: 'concept: Application shell',
        project: 'demo-report',
        status: ContextNodeStatus.ACTIVE,
        metadata: {
          projectGraph: true,
          kind: ProjectGraphNodeKind.CONCEPT,
          provenance: ProjectGraphProvenance.INFERRED,
          summary: 'App.tsx composes the user-facing shell.',
          evidence: [{ path: 'src/App.tsx', startLine: 1, endLine: 3, extractorId: 'llm-enrichment' }],
        },
      });
      memory.context.createContextNode({
        id: 'pg:demo-report:concept:routing-question',
        substrateType: SubstrateType.SNAPSHOT,
        domainType: ContextDomainType.ARCHITECTURE,
        title: 'Routing ownership unclear',
        content: 'concept: Routing ownership unclear',
        project: 'demo-report',
        status: ContextNodeStatus.ACTIVE,
        metadata: {
          projectGraph: true,
          kind: ProjectGraphNodeKind.CONCEPT,
          provenance: ProjectGraphProvenance.AMBIGUOUS,
          summary: 'Confirm whether App.tsx or a nested route owns routing decisions.',
          evidence: [{ path: 'src/App.tsx', extractorId: 'llm-enrichment' }],
        },
      });
      const result = memory.context.writeProjectGraphObsidianProjection(project, vaultRoot);

      expect(result.reportPath).toBe(path.join(vaultRoot, 'demo-report', 'architecture', 'project-graph.md'));
      const report = fs.readFileSync(result.reportPath, 'utf8');
      expect(report).toContain('<!-- mindstrate:project-graph:generated:start -->');
      expect(report).toContain('<!-- mindstrate:project-graph:user-notes:start -->');
      expect(report).toContain('User Notes');
      expect(report).toContain('## Inferred Summaries');
      expect(report).toContain('Application shell');
      expect(report).toContain('App.tsx composes the user-facing shell.');
      expect(report).toContain('Evidence: src/App.tsx:1-3');
      expect(report).toContain('## Open Questions');
      expect(report).toContain('Routing ownership unclear');
      expect(report).toContain('Confirm whether App.tsx or a nested route owns routing decisions.');
      const records = memory.projections.listProjectionRecords({
        target: ProjectionTarget.PROJECT_GRAPH_OBSIDIAN,
        limit: 10,
      });
      expect(records[0].targetRef).toBe(result.reportPath);
    } finally {
      removeTempDir(vaultRoot);
    }
  });

  it('writes project graph files atomically through a temporary sibling file', () => {
    const target = path.join(root, 'PROJECT_GRAPH.md');

    writeProjectGraphTextFileAtomically(target, 'first');
    writeProjectGraphTextFileAtomically(target, 'second');

    expect(fs.readFileSync(target, 'utf8')).toBe('second');
    expect(fs.readdirSync(root).filter((name) => name.includes('.tmp-'))).toEqual([]);
  });
});
