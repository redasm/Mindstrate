import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { Mindstrate, KnowledgeType, CaptureSource } from '@mindstrate/server';
import { SyncManager, parseMarkdown, VaultLayout } from '../src/index.js';
import { createTempDir, removeTempDir } from '../../../tests/support/index.js';

async function makeMemory(dataDir: string): Promise<Mindstrate> {
  const memory = new Mindstrate({ dataDir });
  await memory.init();
  return memory;
}

describe('SyncManager (integration)', () => {
  let dataDir: string;
  let vaultDir: string;
  let memory: Mindstrate;

  beforeEach(async () => {
    dataDir = createTempDir('mindstrate-data-');
    vaultDir = createTempDir('mindstrate-vault-');
    memory = await makeMemory(dataDir);
  });

  afterEach(() => {
    try { memory.close(); } catch { /* ignore */ }
    removeTempDir(dataDir);
    removeTempDir(vaultDir);
  });

  it('exportAll writes all knowledge into project/type folders', async () => {
    const r1 = await memory.knowledge.add({
      type: KnowledgeType.BUG_FIX,
      title: 'Hydration error in Next 15',
      problem: 'Date.now in render causes mismatch',
      solution: 'Move volatile values to useEffect',
      tags: ['next', 'ssr'],
      context: { project: 'website', language: 'typescript', framework: 'next' },
      source: CaptureSource.CLI,
    });
    expect(r1.success).toBe(true);

    const r2 = await memory.knowledge.add({
      type: KnowledgeType.BEST_PRACTICE,
      title: 'Always use absolute imports',
      solution: 'Configure tsconfig paths and prefer @/ imports',
      tags: ['style'],
      context: { project: 'website', language: 'typescript' },
      source: CaptureSource.CLI,
    });
    expect(r2.success).toBe(true);

    const sync = new SyncManager(memory, { vaultRoot: vaultDir, silent: true });
    const out = await sync.exportAll();
    expect(out.errors).toHaveLength(0);
    expect(out.written).toBe(2);

    // Check folder layout
    const bugFiles = fs.readdirSync(path.join(vaultDir, 'website', 'bug-fixes'));
    expect(bugFiles).toHaveLength(1);
    expect(bugFiles[0]).toMatch(/--[a-f0-9]+\.md$/);

    const bpFiles = fs.readdirSync(path.join(vaultDir, 'website', 'best-practices'));
    expect(bpFiles).toHaveLength(1);

    // Check meta index
    const indexPath = path.join(vaultDir, '_meta', 'index.json');
    expect(fs.existsSync(indexPath)).toBe(true);
    const idx = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
    expect(Object.keys(idx.files)).toHaveLength(2);
  });

  it('exports graph updates and deletes during full sync', async () => {
    const sync = new SyncManager(memory, { vaultRoot: vaultDir, silent: true });

    const r = await memory.knowledge.add({
      type: KnowledgeType.GOTCHA,
      title: 'Beware default export with HMR',
      solution: 'Always name your default-exported component to keep refresh state',
      tags: ['react'],
      context: { project: 'frontend', language: 'typescript', framework: 'react' },
      source: CaptureSource.CLI,
    });
    expect(r.success).toBe(true);
    await sync.exportAll();

    const idx = new VaultLayout({ vaultRoot: vaultDir }).loadIndex();
    const rel = idx.files[r.view!.id];
    expect(rel).toBeDefined();

    const abs = path.join(vaultDir, rel.split('/').join(path.sep));
    expect(fs.existsSync(abs)).toBe(true);

    // Update title and ensure file moves to new slug
    memory.context.updateContextNode(r.view!.id, { title: 'Renamed: HMR gotcha with default export' });
    await sync.exportAll();
    const idx2 = new VaultLayout({ vaultRoot: vaultDir }).loadIndex();
    const newRel = idx2.files[r.view!.id];
    expect(newRel).not.toBe(rel);
    expect(fs.existsSync(path.join(vaultDir, newRel.split('/').join(path.sep)))).toBe(true);
    expect(fs.existsSync(abs)).toBe(false);

    // Delete propagates
    memory.context.deleteContextNode(r.view!.id);
    await sync.exportAll();
    expect(fs.existsSync(path.join(vaultDir, newRel.split('/').join(path.sep)))).toBe(false);
    const idx3 = new VaultLayout({ vaultRoot: vaultDir }).loadIndex();
    expect(idx3.files[r.view!.id]).toBeUndefined();
  });

  it('orphan files (KU removed without sink) are cleaned up on full re-export', async () => {
    const sync = new SyncManager(memory, { vaultRoot: vaultDir, silent: true });

    const r = await memory.knowledge.add({
      type: KnowledgeType.HOW_TO,
      title: 'Set up vitest in monorepo',
      solution: 'Create a vitest.config.ts at the workspace root and reference packages',
      context: { project: 'tools', language: 'typescript' },
      source: CaptureSource.CLI,
    });
    await sync.exportAll();

    // Now delete via graph directly (simulating a sink-less deletion)
    memory.context.deleteContextNode(r.view!.id);

    const r2 = await sync.exportAll();
    expect(r2.removed).toBe(1);

    const layout = new VaultLayout({ vaultRoot: vaultDir });
    expect(layout.walkMarkdownFiles()).toHaveLength(0);
  });

  it('reads back edits made directly to a vault file via parseMarkdown', async () => {
    // We don't start the watcher in this test (chokidar tests are flaky/timeouty);
    // we exercise the same code path used by the watcher.
    const sync = new SyncManager(memory, { vaultRoot: vaultDir, silent: true });

    const r = await memory.knowledge.add({
      type: KnowledgeType.PATTERN,
      title: 'Repository pattern',
      solution: 'Encapsulate persistence behind an interface',
      tags: ['ddd'],
      context: { project: 'api', language: 'typescript' },
      source: CaptureSource.CLI,
    });
    await sync.exportAll();

    const idx = new VaultLayout({ vaultRoot: vaultDir }).loadIndex();
    const rel = idx.files[r.view!.id];
    const abs = path.join(vaultDir, rel.split('/').join(path.sep));

    // User edits the markdown manually
    let text = fs.readFileSync(abs, 'utf8');
    text = text.replace('Repository pattern', 'Repository pattern (revised)');
    text = text.replace('Encapsulate persistence behind an interface',
      'Encapsulate persistence behind an interface; testable via fakes');
    fs.writeFileSync(abs, text, 'utf8');

    // Simulate the watcher-side processing
    const reread = fs.readFileSync(abs, 'utf8');
    const parsed = parseMarkdown(reread);
    expect(parsed).not.toBeNull();
    expect(parsed!.title).toContain('revised');
    expect(parsed!.solution).toContain('testable via fakes');
  });

  it('ignores vault edits for mirror-only knowledge types', async () => {
    const sync = new SyncManager(memory, { vaultRoot: vaultDir, silent: true });

    const r = await memory.knowledge.add({
      type: KnowledgeType.GOTCHA,
      title: 'Volatile gotcha',
      solution: 'Original volatile guidance',
      context: { project: 'api', language: 'typescript' },
      source: CaptureSource.CLI,
    });
    await sync.exportAll();

    const idx = new VaultLayout({ vaultRoot: vaultDir }).loadIndex();
    const rel = idx.files[r.view!.id];
    const abs = path.join(vaultDir, rel.split('/').join(path.sep));

    let text = fs.readFileSync(abs, 'utf8');
    text = text.replace('Original volatile guidance', 'Edited in vault but should be ignored');
    fs.writeFileSync(abs, text, 'utf8');

    await (sync.watcher as any).handleAddOrChange(rel);

    const unchanged = memory.context.listContextNodes({ limit: 100 }).find((node) => node.id === r.view!.id);
    expect(unchanged!.content).toBe('Original volatile guidance');
  });

  it('ignores stale vault edits when Mindstrate has newer content', async () => {
    const sync = new SyncManager(memory, { vaultRoot: vaultDir, silent: true });

    const r = await memory.knowledge.add({
      type: KnowledgeType.ARCHITECTURE,
      title: 'Service lifecycle',
      solution: 'Version one of the lifecycle note.',
      context: { project: 'api', language: 'typescript' },
      source: CaptureSource.CLI,
    });
    await sync.exportAll();

    const idx = new VaultLayout({ vaultRoot: vaultDir }).loadIndex();
    const rel = idx.files[r.view!.id];
    const abs = path.join(vaultDir, rel.split('/').join(path.sep));
    const staleText = fs.readFileSync(abs, 'utf8');

    memory.context.updateContextNode(r.view!.id, { content: 'Version two from Mindstrate.' });

    const staleEdited = staleText.replace(
      'Version one of the lifecycle note.',
      'Edited from a stale vault snapshot.',
    );
    fs.writeFileSync(abs, staleEdited, 'utf8');

    await (sync.watcher as any).handleAddOrChange(rel);

    const current = memory.context.listContextNodes({ limit: 100 }).find((node) => node.id === r.view!.id);
    expect(current!.content).toBe('Version two from Mindstrate.');
  });

  it('does not delete mirror-only knowledge when the vault file is removed', async () => {
    const sync = new SyncManager(memory, { vaultRoot: vaultDir, silent: true });

    const r = await memory.knowledge.add({
      type: KnowledgeType.BUG_FIX,
      title: 'Mirror-only bug fix',
      solution: 'Important fix that should stay canonical in Mindstrate.',
      context: { project: 'api', language: 'typescript' },
      source: CaptureSource.CLI,
    });
    await sync.exportAll();

    const idx = new VaultLayout({ vaultRoot: vaultDir }).loadIndex();
    const rel = idx.files[r.view!.id];
    const abs = path.join(vaultDir, rel.split('/').join(path.sep));
    fs.unlinkSync(abs);

    await (sync.watcher as any).handleUnlink(abs);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(memory.context.listContextNodes({ limit: 100 }).some((node) => node.id === r.view!.id)).toBe(true);
  });
});
