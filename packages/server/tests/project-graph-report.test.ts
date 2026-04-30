import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  ContextDomainType,
  ContextNodeStatus,
  ProjectGraphNodeKind,
  ProjectGraphOverlayKind,
  ProjectGraphOverlaySource,
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

  it('renders evidence-rich project graph sections for humans and agents', () => {
    write(root, 'package.json', JSON.stringify({ name: 'sections-demo' }));
    write(root, 'src/App.tsx', 'export function App() { return <main />; }');

    const project = detectProject(root)!;
    memory.context.indexProjectGraph(project);
    memory.context.createContextNode({
      id: 'pg:sections-demo:component:bp-player',
      substrateType: SubstrateType.SNAPSHOT,
      domainType: ContextDomainType.ARCHITECTURE,
      title: '/Game/Characters/BP_Player',
      content: 'component: /Game/Characters/BP_Player',
      project: 'sections-demo',
      status: ContextNodeStatus.ACTIVE,
      metadata: {
        projectGraph: true,
        kind: ProjectGraphNodeKind.COMPONENT,
        provenance: ProjectGraphProvenance.EXTRACTED,
        scanMode: 'metadata-only',
        assetClass: 'Blueprint',
        evidence: [{ path: '.mindstrate/unreal-asset-registry.json', extractorId: 'unreal-asset-registry' }],
      },
    });
    memory.context.createContextNode({
      id: 'pg:sections-demo:dependency:native-export',
      substrateType: SubstrateType.SNAPSHOT,
      domainType: ContextDomainType.ARCHITECTURE,
      title: 'NativeExport',
      content: 'dependency: NativeExport',
      project: 'sections-demo',
      status: ContextNodeStatus.ACTIVE,
      metadata: {
        projectGraph: true,
        kind: ProjectGraphNodeKind.DEPENDENCY,
        provenance: ProjectGraphProvenance.EXTRACTED,
        evidence: [{ path: 'src/App.tsx', startLine: 1, extractorId: 'tree-sitter-source' }],
      },
    });
    memory.context.writeProjectGraphArtifacts(project);

    const report = fs.readFileSync(path.join(root, 'PROJECT_GRAPH.md'), 'utf8');

    expect(report).toContain('## Entry Points');
    expect(report).toContain('## Core Modules');
    expect(report).toContain('## Asset And Blueprint Surfaces');
    expect(report).toContain('/Game/Characters/BP_Player');
    expect(report).toContain('## Native To Script Bindings');
    expect(report).toContain('NativeExport');
    expect(report).toContain('src/App.tsx:1');
  });

  it('keeps generated binding artifacts out of high-impact report lists', () => {
    write(root, 'package.json', JSON.stringify({ name: 'generated-demo' }));
    write(root, '.mindstrate/rules/generated-demo.json', JSON.stringify({
      id: 'generated-demo',
      name: 'Generated Demo',
      priority: 200,
      match: { all: [{ glob: 'package.json' }] },
      detect: { language: 'typescript', framework: 'node', manifest: 'package.json' },
      sourceRoots: ['src', 'TypeScript/Typing'],
      generatedRoots: ['TypeScript/Typing'],
      ignore: [],
    }));
    write(root, 'src/App.ts', 'export function App() { return null; }');
    write(root, 'TypeScript/Typing/UObject.ts', 'export function GeneratedBinding() { return null; }');

    const project = detectProject(root)!;
    memory.context.indexProjectGraph(project);
    memory.context.writeProjectGraphArtifacts(project);

    const graph = JSON.parse(fs.readFileSync(path.join(root, '.mindstrate', 'project-graph.graph.json'), 'utf8')) as {
      nodes: Array<{ label: string; metadata: Record<string, unknown> }>;
    };
    const report = fs.readFileSync(path.join(root, 'PROJECT_GRAPH.md'), 'utf8');

    expect(graph.nodes.find((node) => node.label === 'TypeScript/Typing/UObject.ts')?.metadata).toMatchObject({
      generated: true,
      doNotEdit: true,
      metadataOnly: true,
    });
    expect(report).toContain('TypeScript/Typing');
    expect(report).not.toContain('GeneratedBinding');
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

  it('writes editable Obsidian module pages', () => {
    write(root, 'package.json', JSON.stringify({ name: 'module-pages-demo' }));
    write(root, 'src/App.tsx', 'export function App() { return <main />; }');
    const vaultRoot = createTempDir('mindstrate-project-graph-module-vault-');

    try {
      const project = detectProject(root)!;
      memory.context.indexProjectGraph(project);

      const result = memory.context.writeProjectGraphObsidianProjection(project, vaultRoot);
      const modulePath = path.join(vaultRoot, 'module-pages-demo', 'architecture', 'modules', 'src-app.md');
      expect(fs.existsSync(modulePath)).toBe(true);
      expect(result.modulePaths).toContain(modulePath);
      expect(result.modulePaths.every((filePath) =>
        filePath.includes(`${path.sep}architecture${path.sep}modules${path.sep}`))).toBe(true);
      expect(fs.existsSync(path.join(vaultRoot, 'module-pages-demo', 'architecture', 'functions'))).toBe(false);
      expect(fs.existsSync(path.join(vaultRoot, 'module-pages-demo', 'architecture', 'components'))).toBe(false);

      let modulePage = fs.readFileSync(modulePath, 'utf8');
      expect(modulePage).toContain('# Module: src/App');
      expect(modulePage).toContain('src/App.tsx');
      expect(modulePage).toContain('<!-- mindstrate:project-graph:module-notes:start -->');

      modulePage = modulePage.replace(
        '- Add module notes, confirmations, corrections, or risks here.',
        '- This module owns the application shell.',
      );
      fs.writeFileSync(modulePath, modulePage, 'utf8');
      memory.context.writeProjectGraphObsidianProjection(project, vaultRoot);

      expect(fs.readFileSync(modulePath, 'utf8')).toContain('- This module owns the application shell.');
    } finally {
      removeTempDir(vaultRoot);
    }
  });

  it('renders user overlays in project and module projections without mutating raw facts', () => {
    write(root, 'package.json', JSON.stringify({ name: 'overlay-report-demo' }));
    write(root, 'src/App.tsx', 'export function App() { return <main />; }');
    const vaultRoot = createTempDir('mindstrate-project-graph-overlay-vault-');

    try {
      const project = detectProject(root)!;
      memory.context.indexProjectGraph(project);
      const appNode = memory.context.listContextNodes({ project: 'overlay-report-demo', limit: 100 })
        .find((node) => node.title === 'src/App.tsx')!;

      memory.context.createProjectGraphOverlay({
        project: 'overlay-report-demo',
        targetNodeId: appNode.id,
        kind: ProjectGraphOverlayKind.CORRECTION,
        content: 'App.tsx owns the runtime shell, not only a React component.',
        source: ProjectGraphOverlaySource.OBSIDIAN,
      });
      memory.context.createProjectGraphOverlay({
        project: 'overlay-report-demo',
        targetNodeId: appNode.id,
        kind: ProjectGraphOverlayKind.CONFIRMATION,
        content: 'Human confirmed App.tsx as an entry point.',
        source: ProjectGraphOverlaySource.OBSIDIAN,
      });
      memory.context.createProjectGraphOverlay({
        project: 'overlay-report-demo',
        kind: ProjectGraphOverlayKind.RISK,
        content: 'Generated binding folders must stay metadata-only in reports.',
        source: ProjectGraphOverlaySource.OBSIDIAN,
      });
      memory.context.createProjectGraphOverlay({
        project: 'overlay-report-demo',
        kind: ProjectGraphOverlayKind.CONVENTION,
        content: 'Module pages should describe ownership before file lists.',
        source: ProjectGraphOverlaySource.OBSIDIAN,
      });

      const result = memory.context.writeProjectGraphObsidianProjection(project, vaultRoot);
      const report = fs.readFileSync(result.reportPath, 'utf8');
      const modulePage = fs.readFileSync(
        path.join(vaultRoot, 'overlay-report-demo', 'architecture', 'modules', 'src-app.md'),
        'utf8',
      );
      const graph = JSON.parse(fs.readFileSync(result.graphPath, 'utf8')) as {
        nodes: Array<{ id: string; confidence: number; salience: number }>;
        overlays: Array<{ content: string }>;
      };

      expect(memory.context.getContextNode(appNode.id)?.title).toBe('src/App.tsx');
      expect(graph.nodes.find((node) => node.id === appNode.id)).toMatchObject({
        confidence: 0.99,
        salience: 99,
      });
      expect(graph.overlays).toEqual(expect.arrayContaining([
        expect.objectContaining({ content: 'Human confirmed App.tsx as an entry point.' }),
      ]));
      expect(report).toContain('## User Corrections');
      expect(report).toContain('App.tsx owns the runtime shell, not only a React component.');
      expect(report).toContain('## User Risks');
      expect(report).toContain('Generated binding folders must stay metadata-only in reports.');
      expect(report).toContain('## User Conventions');
      expect(report).toContain('Module pages should describe ownership before file lists.');
      expect(modulePage).toContain('## User Corrections');
      expect(modulePage).toContain('App.tsx owns the runtime shell, not only a React component.');
    } finally {
      removeTempDir(vaultRoot);
    }
  });

  it('imports structured Obsidian overlay blocks before re-rendering projections', () => {
    write(root, 'package.json', JSON.stringify({ name: 'overlay-import-demo' }));
    write(root, 'src/App.tsx', 'export function App() { return <main />; }');
    const vaultRoot = createTempDir('mindstrate-project-graph-overlay-import-vault-');

    try {
      const project = detectProject(root)!;
      memory.context.indexProjectGraph(project);
      const appNode = memory.context.listContextNodes({ project: 'overlay-import-demo', limit: 100 })
        .find((node) => node.title === 'src/App.tsx')!;
      const reportPath = path.join(vaultRoot, 'overlay-import-demo', 'architecture', 'project-graph.md');
      fs.mkdirSync(path.dirname(reportPath), { recursive: true });
      fs.writeFileSync(reportPath, [
        '<!-- mindstrate:project-graph:overlay:start -->',
        '- kind: correction',
        `  target: node:${appNode.id}`,
        '  content: Imported correction from Obsidian.',
        '- kind: confirmation',
        `  target: node:${appNode.id}`,
        '  content: Imported confirmation from Obsidian.',
        '<!-- mindstrate:project-graph:overlay:end -->',
      ].join('\n'), 'utf8');

      memory.context.writeProjectGraphObsidianProjection(project, vaultRoot);
      const overlays = memory.context.listProjectGraphOverlays({ project: 'overlay-import-demo' });
      const report = fs.readFileSync(reportPath, 'utf8');
      const graph = JSON.parse(fs.readFileSync(path.join(root, '.mindstrate', 'project-graph.graph.json'), 'utf8')) as {
        nodes: Array<{ label: string; confidence: number; salience: number }>;
      };

      expect(overlays).toEqual(expect.arrayContaining([
        expect.objectContaining({
          kind: ProjectGraphOverlayKind.CORRECTION,
          targetNodeId: appNode.id,
          content: 'Imported correction from Obsidian.',
        }),
      ]));
      expect(graph.nodes.find((node) => node.label === 'src/App.tsx')).toMatchObject({
        confidence: 0.99,
        salience: 99,
      });
      expect(report).toContain('<!-- mindstrate:project-graph:overlay:start -->');
      expect(report).toContain('## User Corrections');
      expect(report).toContain('Imported correction from Obsidian.');
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
