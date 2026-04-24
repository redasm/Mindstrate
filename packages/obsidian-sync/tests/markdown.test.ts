import { describe, expect, it } from 'vitest';
import {
  computeBodyHash,
  getVaultSyncMode,
  parseMarkdown,
  parsedToCreate,
  parsedToUpdate,
  serializeGraphKnowledge,
} from '../src/markdown.js';
import {
  ContextDomainType,
  ContextNodeStatus,
  KnowledgeType,
  SubstrateType,
  type GraphKnowledgeView,
} from '@mindstrate/server';

const makeView = (overrides: Partial<GraphKnowledgeView> = {}): GraphKnowledgeView => ({
  id: '1234abcd-5678-90ab-cdef-1234567890ab',
  title: 'Fix React useEffect loop',
  summary: 'Memoize the object with useMemo, or move it outside the component.',
  substrateType: SubstrateType.EPISODE,
  domainType: ContextDomainType.BUG_FIX,
  project: 'my-app',
  priorityScore: 0.75,
  status: ContextNodeStatus.ACTIVE,
  tags: ['react', 'hooks'],
  ...overrides,
});

describe('markdown serializer', () => {
  it('round-trips a graph knowledge view through serialize/parse', () => {
    const view = makeView();
    const md = serializeGraphKnowledge(view);
    expect(md).toContain('---');
    expect(md).toContain('# Fix React useEffect loop');
    expect(md).toContain('## Solution');
    expect(md).toContain('mindstrate:end');

    const parsed = parseMarkdown(md);
    expect(parsed).not.toBeNull();
    expect(parsed!.frontmatter.id).toBe(view.id);
    expect(parsed!.frontmatter.type).toBe(KnowledgeType.BUG_FIX);
    expect(parsed!.frontmatter.tags).toEqual(['react', 'hooks']);
    expect(parsed!.frontmatter.project).toBe('my-app');
    expect(parsed!.title).toBe(view.title);
    expect(parsed!.solution).toContain('useMemo');
  });

  it('preserves user notes below the end marker', () => {
    const md = serializeGraphKnowledge(makeView(), {
      preserveUserNotes: 'My personal note: try this in v19 too.',
    });
    const parsed = parseMarkdown(md)!;
    expect(parsed.userNotes).toContain('My personal note');
  });

  it('produces stable bodyHash for identical graph content', () => {
    const view = makeView();
    const md1 = serializeGraphKnowledge(view);
    const md2 = serializeGraphKnowledge(view, { syncedAt: 'whatever' });
    expect(computeBodyHash(md1)).toBe(computeBodyHash(md2));
  });

  it('parsedToUpdate maps graph markdown fields back into UpdateKnowledgeInput', () => {
    const view = makeView();
    const parsed = parseMarkdown(serializeGraphKnowledge(view))!;
    const update = parsedToUpdate(parsed);
    expect(update.title).toBe(view.title);
    expect(update.solution).toBe(view.summary);
    expect(update.tags).toEqual(['react', 'hooks']);
    expect(update.context?.project).toBe('my-app');
  });

  it('parsedToCreate maps graph markdown fields into CreateKnowledgeInput', () => {
    const view = makeView({ domainType: ContextDomainType.ARCHITECTURE });
    const parsed = parseMarkdown(serializeGraphKnowledge(view))!;
    const create = parsedToCreate(parsed);
    expect(create.title).toBe(view.title);
    expect(create.type).toBe(KnowledgeType.ARCHITECTURE);
    expect(create.context?.project).toBe('my-app');
  });

  it('returns null for markdown without frontmatter', () => {
    expect(parseMarkdown('# Just a title')).toBeNull();
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

  it('falls back to type-based sync mode for markdown without syncMode', () => {
    const md = serializeGraphKnowledge(
      makeView({ domainType: ContextDomainType.GOTCHA, title: 'Legacy gotcha' }),
    ).replace(/^syncMode:.*\r?\n/m, '');
    const parsed = parseMarkdown(md)!;

    expect(parsed.frontmatter.syncMode).toBe('mirror');
  });
});
