import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { ProjectionTarget } from '@mindstrate/protocol/models';
import { Mindstrate, detectProject } from '../src/index.js';
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

  it('writes a readable report and machine stats next to the project', () => {
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

    expect(result.reportPath).toBe(path.join(root, 'PROJECT_GRAPH.md'));
    expect(report).toContain('# Project Graph: demo-report');
    expect(report).toContain('src/App.tsx');
    expect(report).toContain('EXTRACTED');
    expect(report).toContain('mindstrate graph query "entry points"');
    expect(stats.project).toBe('demo-report');
    expect(stats.nodes).toBeGreaterThan(0);
    expect(stats.edges).toBeGreaterThan(0);
    expect(stats.firstFiles).toContain('src/App.tsx');
    expect(stats.provenanceCounts.EXTRACTED).toBeGreaterThan(0);
    const records = memory.projections.listProjectionRecords({
      target: ProjectionTarget.PROJECT_GRAPH_REPO_ENTRY,
      limit: 10,
    });
    expect(records[0].targetRef).toBe(result.reportPath);
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
      const result = memory.context.writeProjectGraphObsidianProjection(project, vaultRoot);

      expect(result.reportPath).toBe(path.join(vaultRoot, 'demo-report', 'architecture', 'project-graph.md'));
      const report = fs.readFileSync(result.reportPath, 'utf8');
      expect(report).toContain('<!-- mindstrate:project-graph:generated:start -->');
      expect(report).toContain('<!-- mindstrate:project-graph:user-notes:start -->');
      expect(report).toContain('User Notes');
      const records = memory.projections.listProjectionRecords({
        target: ProjectionTarget.PROJECT_GRAPH_OBSIDIAN,
        limit: 10,
      });
      expect(records[0].targetRef).toBe(result.reportPath);
    } finally {
      removeTempDir(vaultRoot);
    }
  });
});
