import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
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
import { createTempDir, removeTempDir } from './test-support.js';

function writePackageJson(root: string, body: any): void {
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify(body), 'utf8');
}

describe('buildProjectSnapshot', () => {
  it('produces deterministic ids for the same root + name', () => {
    const root = createTempDir('mindstrate-snap-');
    try {
      writePackageJson(root, { name: 'x', dependencies: { react: '^18' } });
      const p = detectProject(root)!;
      const a = projectSnapshotId(p);
      const b = projectSnapshotId(p);
      expect(a).toBe(b);
      expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-8[0-9a-f]{3}-[0-9a-f]{12}$/);
    } finally {
      removeTempDir(root);
    }
  });

  it('renders a complete snapshot body with required sections', () => {
    const root = createTempDir('mindstrate-snap-');
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
      removeTempDir(root);
    }
  });

  it('renders rule-derived snapshot guidance outside preserve blocks', () => {
    const root = createTempDir('mindstrate-snap-');
    try {
      fs.writeFileSync(path.join(root, 'Client.uproject'), JSON.stringify({ FileVersion: 3 }), 'utf8');
      fs.mkdirSync(path.join(root, 'Content'));
      fs.mkdirSync(path.join(root, 'Config'));
      fs.mkdirSync(path.join(root, 'Source', 'Client'), { recursive: true });
      fs.writeFileSync(path.join(root, 'Source', 'Client', 'Client.Build.cs'), 'public class Client {}', 'utf8');

      const p = detectProject(root)!;
      const r = buildProjectSnapshot(p);
      const sol = r.input.solution;

      expect(sol).toContain('This appears to be an Unreal Engine project.');
      expect(sol).toContain('## Directory Notes');
      expect(sol).toContain('- `Binaries/` — Generated build output; do not edit manually.');
      expect(sol).toContain('## Detected Invariants');
      expect(sol).toContain('Do not edit Binaries, Intermediate, Saved, or DerivedDataCache unless explicitly requested.');
      expect(sol).toContain(PRESERVE_OPEN);
    } finally {
      removeTempDir(root);
    }
  });

  it('preserves user-edited content inside preserve markers across re-renders', () => {
    const root = createTempDir('mindstrate-snap-');
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
      removeTempDir(root);
    }
  });
});

describe('Mindstrate.upsertProjectSnapshot', () => {
  let root: string;
  let dataDir: string;
  let memory: Mindstrate;

  beforeEach(async () => {
    root = createTempDir('mindstrate-snap-');
    dataDir = createTempDir('mindstrate-data-');
    writePackageJson(root, { name: 'svc', dependencies: { express: '^4' } });
    memory = new Mindstrate({ dataDir });
    await memory.init();
  });

  afterEach(() => {
    try { memory.close(); } catch {}
    removeTempDir(root);
    removeTempDir(dataDir);
  });

  it('creates a project snapshot graph node with a deterministic id', async () => {
    const p = detectProject(root)!;
    const r = await memory.snapshots.upsertProjectSnapshot(p);
    expect(r.created).toBe(true);
    expect(r.changed).toBe(true);
    expect(r.node.id).toBe(projectSnapshotId(p));
    expect(r.node.title).toContain('svc');
  });

  it('materializes project snapshots from ECS graph nodes', async () => {
    const p = detectProject(root)!;
    const r = await memory.snapshots.upsertProjectSnapshot(p);

    const nodes = memory.context.listContextNodes({
      project: p.name,
      substrateType: SubstrateType.SNAPSHOT,
      domainType: ContextDomainType.PROJECT_SNAPSHOT,
    });
    const projection = memory.projections.listProjectionRecords({
      target: ProjectionTarget.PROJECT_SNAPSHOT,
      limit: 10,
    });

    expect(nodes).toHaveLength(1);
    expect(nodes[0].sourceRef).toBe(r.node.id);
    expect(projection.find((record) => record.nodeId === nodes[0].id)?.targetRef).toBe(r.node.id);
  });

  it('is idempotent: repeated upserts converge to a single record', async () => {
    const p = detectProject(root)!;
    const a = await memory.snapshots.upsertProjectSnapshot(p);
    const b = await memory.snapshots.upsertProjectSnapshot(p);
    const c = await memory.snapshots.upsertProjectSnapshot(p);
    expect(a.node.id).toBe(b.node.id);
    expect(b.node.id).toBe(c.node.id);
    expect(b.created).toBe(false);
    expect(c.created).toBe(false);
    // Body should be stable -> changed:false on subsequent runs
    expect(b.changed).toBe(false);
    expect(c.changed).toBe(false);
    // Only one record exists
    expect(memory.context.listContextNodes({ sourceRef: a.node.id, limit: 100 })).toHaveLength(1);
  });

  it('detects stack changes and re-renders, but keeps preserve blocks', async () => {
    const p1 = detectProject(root)!;
    const r1 = await memory.snapshots.upsertProjectSnapshot(p1);

    // User edits the Critical Invariants section in the DB.
    const node = memory.context.listContextNodes({
      sourceRef: r1.node.id,
      limit: 10,
    })[0];
    const edited = node.content.replace(
      new RegExp(
        `(## Critical Invariants[\\s\\S]*?${escape(PRESERVE_OPEN)})[\\s\\S]*?(${escape(PRESERVE_CLOSE)})`,
      ),
      `$1\nDB writes go through the repository layer only.\n$2`,
    );
    memory.context.updateContextNode(node.id, { content: edited });

    // Stack changes (add a new framework dep)
    writePackageJson(root, {
      name: 'svc',
      dependencies: { express: '^4', '@nestjs/core': '^10' },
    });
    const p2 = detectProject(root)!;
    const r2 = await memory.snapshots.upsertProjectSnapshot(p2);
    expect(r2.created).toBe(false);
    expect(r2.changed).toBe(true);
    const updatedNode = memory.context.listContextNodes({ sourceRef: r2.node.id, limit: 10 })[0];
    expect(updatedNode.content).toContain('DB writes go through the repository layer only.');
    expect(updatedNode.content).toContain('@nestjs/core');
    // Framework hint detection picked up nestjs (higher specificity)
    expect(updatedNode.content).toContain('nestjs');
  });

  it('keeps two different projects isolated (different ids, both stored)', async () => {
    const root2 = createTempDir('mindstrate-snap-');
    try {
      writePackageJson(root2, { name: 'web', dependencies: { react: '^18' } });
      const p1 = detectProject(root)!;
      const p2 = detectProject(root2)!;
      const r1 = await memory.snapshots.upsertProjectSnapshot(p1);
      const r2 = await memory.snapshots.upsertProjectSnapshot(p2);
      expect(r1.node.id).not.toBe(r2.node.id);
      expect(memory.context.listContextNodes({ sourceRef: r1.node.id, limit: 100 })).toHaveLength(1);
      expect(memory.context.listContextNodes({ sourceRef: r2.node.id, limit: 100 })).toHaveLength(1);
    } finally {
      removeTempDir(root2);
    }
  });
});

describe('project meta file', () => {
  it('round-trips and writes a sensible .gitignore', () => {
    const root = createTempDir('mindstrate-meta-');
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
      removeTempDir(root);
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
