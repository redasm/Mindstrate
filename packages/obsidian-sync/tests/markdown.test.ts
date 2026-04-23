import { describe, it, expect } from 'vitest';
import {
  serializeKnowledge,
  parseMarkdown,
  parsedToCreate,
  parsedToUpdate,
  computeBodyHash,
  getVaultSyncMode,
} from '../src/markdown.js';
import type { KnowledgeUnit } from '@mindstrate/server';
import { KnowledgeType, KnowledgeStatus, CaptureSource } from '@mindstrate/server';

function makeKU(overrides: Partial<KnowledgeUnit> = {}): KnowledgeUnit {
  const now = new Date('2026-01-01T00:00:00.000Z').toISOString();
  return {
    id: '1234abcd-5678-90ab-cdef-1234567890ab',
    version: 1,
    type: KnowledgeType.BUG_FIX,
    title: 'Fix React useEffect loop',
    problem: 'useEffect runs in an infinite loop because the dep array contains a new object each render.',
    solution: 'Memoize the object with useMemo, or move it outside the component.',
    codeSnippets: [
      {
        language: 'tsx',
        code: 'const opts = useMemo(() => ({ a: 1 }), []);',
        filePath: 'src/App.tsx',
        description: 'Stable reference',
      },
    ],
    tags: ['react', 'hooks'],
    context: {
      project: 'my-app',
      language: 'typescript',
      framework: 'react',
      filePaths: ['src/App.tsx'],
      dependencies: ['react@18'],
    },
    metadata: {
      author: 'alice',
      source: CaptureSource.CLI,
      createdAt: now,
      updatedAt: now,
      confidence: 0.9,
    },
    quality: {
      score: 75,
      upvotes: 3,
      downvotes: 0,
      useCount: 5,
      verified: false,
      status: KnowledgeStatus.ACTIVE,
    },
    actionable: {
      preconditions: ['You see infinite re-renders in dev tools'],
      steps: [
        'Identify the dependency causing churn',
        'Wrap with useMemo or hoist out of component',
      ],
      verification: 'Open React profiler; render count should stabilize.',
      antiPatterns: ['Disabling the eslint-react-hooks rule'],
    },
    ...overrides,
  };
}

describe('markdown serializer', () => {
  it('round-trips a knowledge unit through serialize/parse', () => {
    const k = makeKU();
    const md = serializeKnowledge(k);
    expect(md).toContain('---');
    expect(md).toContain('# Fix React useEffect loop');
    expect(md).toContain('## Problem');
    expect(md).toContain('## Solution');
    expect(md).toContain('## Code');
    expect(md).toContain('## Steps');
    expect(md).toContain('mindstrate:end');

    const parsed = parseMarkdown(md);
    expect(parsed).not.toBeNull();
    expect(parsed!.frontmatter.id).toBe(k.id);
    expect(parsed!.frontmatter.type).toBe(k.type);
    expect(parsed!.frontmatter.tags).toEqual(['react', 'hooks']);
    expect(parsed!.frontmatter.project).toBe('my-app');
    expect(parsed!.title).toBe(k.title);
    expect(parsed!.problem).toContain('infinite loop');
    expect(parsed!.solution).toContain('useMemo');
    expect(parsed!.codeSnippets).toHaveLength(1);
    expect(parsed!.codeSnippets![0].language).toBe('tsx');
    expect(parsed!.codeSnippets![0].filePath).toBe('src/App.tsx');
    expect(parsed!.codeSnippets![0].code).toContain('useMemo');
    expect(parsed!.actionable!.steps).toHaveLength(2);
    expect(parsed!.actionable!.verification).toContain('profiler');
    expect(parsed!.actionable!.antiPatterns).toHaveLength(1);
  });

  it('preserves user notes below the end marker', () => {
    const k = makeKU();
    const md = serializeKnowledge(k, { preserveUserNotes: 'My personal note: try this in v19 too.' });
    const parsed = parseMarkdown(md)!;
    expect(parsed.userNotes).toContain('My personal note');
  });

  it('produces stable bodyHash for identical content', () => {
    const k = makeKU();
    const md1 = serializeKnowledge(k);
    const md2 = serializeKnowledge(k, { syncedAt: 'whatever' });
    // syncedAt and other frontmatter fields differ, but body section must be identical
    expect(computeBodyHash(md1)).toBe(computeBodyHash(md2));
  });

  it('parsedToUpdate maps fields back into UpdateKnowledgeInput', () => {
    const k = makeKU();
    const md = serializeKnowledge(k);
    const parsed = parseMarkdown(md)!;
    const update = parsedToUpdate(parsed);
    expect(update.title).toBe(k.title);
    expect(update.solution).toBe(k.solution);
    expect(update.tags).toEqual(['react', 'hooks']);
    expect(update.context?.project).toBe('my-app');
    expect(update.actionable?.steps).toHaveLength(2);
  });

  it('parsedToCreate maps fields into CreateKnowledgeInput', () => {
    const k = makeKU();
    const md = serializeKnowledge(k);
    const parsed = parseMarkdown(md)!;
    const create = parsedToCreate(parsed);
    expect(create.title).toBe(k.title);
    expect(create.type).toBe(k.type);
    expect(create.context?.framework).toBe('react');
  });

  it('returns null for markdown without frontmatter', () => {
    expect(parseMarkdown('# Just a title')).toBeNull();
  });

  it('handles knowledge with no problem/code/actionable', () => {
    const k = makeKU({
      problem: undefined,
      codeSnippets: undefined,
      actionable: undefined,
    });
    const md = serializeKnowledge(k);
    const parsed = parseMarkdown(md)!;
    expect(parsed.problem).toBeUndefined();
    expect(parsed.codeSnippets).toBeUndefined();
    expect(parsed.actionable).toBeUndefined();
    expect(parsed.solution).toContain('useMemo');
  });

  it('marks long-lived knowledge as editable sync mode', () => {
    expect(getVaultSyncMode(KnowledgeType.ARCHITECTURE)).toBe('editable');
    expect(getVaultSyncMode(KnowledgeType.CONVENTION)).toBe('editable');
    expect(getVaultSyncMode(KnowledgeType.WORKFLOW)).toBe('editable');
  });

  it('marks volatile knowledge as mirror sync mode', () => {
    expect(getVaultSyncMode(KnowledgeType.BUG_FIX)).toBe('mirror');
    expect(getVaultSyncMode(KnowledgeType.GOTCHA)).toBe('mirror');
    expect(getVaultSyncMode(KnowledgeType.TROUBLESHOOTING)).toBe('mirror');
  });

  it('falls back to type-based sync mode for legacy markdown without syncMode', () => {
    const k = makeKU({ type: KnowledgeType.GOTCHA, title: 'Legacy gotcha' });
    const md = serializeKnowledge(k).replace(/^syncMode:.*\r?\n/m, '');
    const parsed = parseMarkdown(md)!;

    expect(parsed.frontmatter.syncMode).toBe('mirror');
  });
});
