import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import {
  Mindstrate,
  ContextDomainType,
  ProjectionTarget,
  SubstrateType,
  detectProject,
  buildProjectSnapshot,
  projectSnapshotId,
  PRESERVE_OPEN,
  PRESERVE_CLOSE,
  loadProjectMeta,
  saveProjectMeta,
  dependencyFingerprint,
} from '../src/index.js';

function tmp(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function writePackageJson(root: string, body: any): void {
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify(body), 'utf8');
}

describe('buildProjectSnapshot', () => {
  it('produces deterministic ids for the same root + name', () => {
    const root = tmp('mindstrate-snap-');
    try {
      writePackageJson(root, { name: 'x', dependencies: { react: '^18' } });
      const p = detectProject(root)!;
      const a = projectSnapshotId(p);
      const b = projectSnapshotId(p);
      expect(a).toBe(b);
      expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-8[0-9a-f]{3}-[0-9a-f]{12}$/);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('renders a complete snapshot body with required sections', () => {
    const root = tmp('mindstrate-snap-');
    try {
      writePackageJson(root, {
        name: 'svc',
        version: '0.1.0',
        description: 'demo svc',
        dependencies: { express: '^4' },
        devDependencies: { typescript: '^5' },
        scripts: { start: 'node dist/server.js' },
      });
      fs.writeFileSync(path.join(root, 'tsconfig.json'), '{}');
      const p = detectProject(root)!;
      const r = buildProjectSnapshot(p);
      expect(r.id).toBeDefined();
      expect(r.changed).toBe(true);
      const sol = r.input.solution;
      expect(sol).toContain('## Overview');
      expect(sol).toContain('## Tech Stack');
      expect(sol).toContain('## Dependencies');
      expect(sol).toContain('## Scripts');
      expect(sol).toContain('## Architecture & Lifecycle');
      expect(sol).toContain('## Critical Invariants');
      expect(sol).toContain('## Conventions');
      expect(sol).toContain(PRESERVE_OPEN);
      expect(sol).toContain(PRESERVE_CLOSE);
      // Tags include language + framework
      expect(r.input.tags).toContain('typescript');
      expect(r.input.tags).toContain('express');
      expect(r.input.tags).toContain('project-snapshot');
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('preserves user-edited content inside preserve markers across re-renders', () => {
    const root = tmp('mindstrate-snap-');
    try {
      writePackageJson(root, { name: 'svc', dependencies: { express: '^4' } });
      const p = detectProject(root)!;
      const first = buildProjectSnapshot(p);
      // Simulate the user editing the Critical Invariants block in the previous solution.
      const edited = first.input.solution.replace(
        new RegExp(
          `(## Critical Invariants[\\s\\S]*?${escape(PRESERVE_OPEN)})[\\s\\S]*?(${escape(PRESERVE_CLOSE)})`,
        ),
        `$1\nThe Model singleton is initialized at startup; runtime code may assume non-null.\n$2`,
      );
      const second = buildProjectSnapshot(p, { previousSolution: edited });
      expect(second.input.solution).toContain('Model singleton is initialized at startup');
      // Other preserve sections still get default text
      expect(second.input.solution).toContain('## Architecture & Lifecycle');
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('Mindstrate.upsertProjectSnapshot', () => {
  let root: string;
  let dataDir: string;
  let memory: Mindstrate;

  beforeEach(async () => {
    root = tmp('mindstrate-snap-');
    dataDir = tmp('mindstrate-data-');
    writePackageJson(root, { name: 'svc', dependencies: { express: '^4' } });
    memory = new Mindstrate({ dataDir });
    await memory.init();
  });

  afterEach(() => {
    try { memory.close(); } catch {}
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  it('creates a project snapshot KU with a deterministic id', async () => {
    const p = detectProject(root)!;
    const r = await memory.upsertProjectSnapshot(p);
    expect(r.created).toBe(true);
    expect(r.changed).toBe(true);
    expect(r.knowledge.id).toBe(projectSnapshotId(p));
    expect(r.knowledge.title).toContain('svc');
  });

  it('materializes project snapshots from ECS graph nodes', async () => {
    const p = detectProject(root)!;
    const r = await memory.upsertProjectSnapshot(p);
    const internal = memory as unknown as {
      contextGraphStore: {
        listNodes(input: Record<string, unknown>): Array<{ id: string; sourceRef?: string }>;
        listProjectionRecords(input: Record<string, unknown>): Array<{ nodeId: string; target: string; targetRef: string }>;
      };
    };

    const nodes = internal.contextGraphStore.listNodes({
      project: p.name,
      substrateType: SubstrateType.SNAPSHOT,
      domainType: ContextDomainType.PROJECT_SNAPSHOT,
    });
    const projection = internal.contextGraphStore.listProjectionRecords({
      target: ProjectionTarget.PROJECT_SNAPSHOT,
      limit: 10,
    });

    expect(nodes).toHaveLength(1);
    expect(nodes[0].sourceRef).toBe(r.knowledge.id);
    expect(projection.find((record) => record.nodeId === nodes[0].id)?.targetRef).toBe(r.knowledge.id);
  });

  it('is idempotent: repeated upserts converge to a single record', async () => {
    const p = detectProject(root)!;
    const a = await memory.upsertProjectSnapshot(p);
    const b = await memory.upsertProjectSnapshot(p);
    const c = await memory.upsertProjectSnapshot(p);
    expect(a.knowledge.id).toBe(b.knowledge.id);
    expect(b.knowledge.id).toBe(c.knowledge.id);
    expect(b.created).toBe(false);
    expect(c.created).toBe(false);
    // Body should be stable -> changed:false on subsequent runs
    expect(b.changed).toBe(false);
    expect(c.changed).toBe(false);
    // Only one record exists
    expect(memory.listContextNodes({ sourceRef: a.view.sourceRef ?? a.view.id, limit: 100 })).toHaveLength(1);
  });

  it('detects stack changes and re-renders, but keeps preserve blocks', async () => {
    const p1 = detectProject(root)!;
    const r1 = await memory.upsertProjectSnapshot(p1);

    // User edits the Critical Invariants section in the DB.
    const node = memory.listContextNodes({
      sourceRef: r1.view.id,
      limit: 10,
    })[0];
    const edited = node.content.replace(
      new RegExp(
        `(## Critical Invariants[\\s\\S]*?${escape(PRESERVE_OPEN)})[\\s\\S]*?(${escape(PRESERVE_CLOSE)})`,
      ),
      `$1\nDB writes go through the repository layer only.\n$2`,
    );
    memory.updateContextNode(node.id, { content: edited });

    // Stack changes (add a new framework dep)
    writePackageJson(root, {
      name: 'svc',
      dependencies: { express: '^4', '@nestjs/core': '^10' },
    });
    const p2 = detectProject(root)!;
    const r2 = await memory.upsertProjectSnapshot(p2);
    expect(r2.created).toBe(false);
    expect(r2.changed).toBe(true);
    const updatedNode = memory.listContextNodes({ sourceRef: r2.view.id, limit: 10 })[0];
    expect(updatedNode.content).toContain('DB writes go through the repository layer only.');
    expect(updatedNode.content).toContain('@nestjs/core');
    // Framework hint detection picked up nestjs (higher specificity)
    expect(updatedNode.content).toContain('nestjs');
  });

  it('keeps two different projects isolated (different ids, both stored)', async () => {
    const root2 = tmp('mindstrate-snap-');
    try {
      writePackageJson(root2, { name: 'web', dependencies: { react: '^18' } });
      const p1 = detectProject(root)!;
      const p2 = detectProject(root2)!;
      const r1 = await memory.upsertProjectSnapshot(p1);
      const r2 = await memory.upsertProjectSnapshot(p2);
      expect(r1.knowledge.id).not.toBe(r2.knowledge.id);
      expect(memory.listContextNodes({ sourceRef: r1.view.sourceRef ?? r1.view.id, limit: 100 })).toHaveLength(1);
      expect(memory.listContextNodes({ sourceRef: r2.view.sourceRef ?? r2.view.id, limit: 100 })).toHaveLength(1);
    } finally {
      fs.rmSync(root2, { recursive: true, force: true });
    }
  });
});

describe('project meta file', () => {
  it('round-trips and writes a sensible .gitignore', () => {
    const root = tmp('mindstrate-meta-');
    try {
      const meta = {
        version: 1,
        name: 'svc',
        rootHint: root,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
        fingerprint: 'fp',
      };
      saveProjectMeta(root, meta);
      const loaded = loadProjectMeta(root);
      expect(loaded?.name).toBe('svc');
      const gi = fs.readFileSync(path.join(root, '.mindstrate', '.gitignore'), 'utf8');
      expect(gi).toContain('mindstrate.db');
      expect(gi).toContain('vectors/');
      expect(gi).toContain('!project.json');
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('dependencyFingerprint is order-insensitive', () => {
    const a = dependencyFingerprint({
      language: 'ts', framework: 'next.js',
      dependencies: [{ name: 'a' }, { name: 'b' }, { name: 'c' }] as any,
    });
    const b = dependencyFingerprint({
      language: 'ts', framework: 'next.js',
      dependencies: [{ name: 'c' }, { name: 'a' }, { name: 'b' }] as any,
    });
    expect(a).toBe(b);
  });
});

function escape(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
