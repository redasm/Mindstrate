import { describe, it, expect } from 'vitest';
import {
  KnowledgeType,
  KnowledgeStatus,
  CaptureSource,
  isValidKnowledgeType,
} from '../src/models/knowledge.js';

/**
 * Enum stability tests.
 *
 * The string values of these enums travel over the wire (HTTP, MCP, Obsidian
 * markdown frontmatter) and are persisted to disk (SQLite). Changing any
 * value here is a BREAKING change for every existing knowledge base.
 *
 * If a test below fails because you intentionally renamed a value, add the
 * old value to a migration step BEFORE updating the test.
 */
describe('protocol enum stability', () => {
  it('KnowledgeType values are stable', () => {
    expect(KnowledgeType.BUG_FIX).toBe('bug_fix');
    expect(KnowledgeType.BEST_PRACTICE).toBe('best_practice');
    expect(KnowledgeType.ARCHITECTURE).toBe('architecture');
    expect(KnowledgeType.CONVENTION).toBe('convention');
    expect(KnowledgeType.PATTERN).toBe('pattern');
    expect(KnowledgeType.TROUBLESHOOTING).toBe('troubleshooting');
    expect(KnowledgeType.GOTCHA).toBe('gotcha');
    expect(KnowledgeType.HOW_TO).toBe('how_to');
    expect(KnowledgeType.WORKFLOW).toBe('workflow');

    // The exhaustive list — guards against accidental additions slipping in
    // without explicit thought about migration / web UI / extractor prompts.
    expect(Object.values(KnowledgeType).sort()).toEqual([
      'architecture',
      'best_practice',
      'bug_fix',
      'convention',
      'gotcha',
      'how_to',
      'pattern',
      'troubleshooting',
      'workflow',
    ]);
  });

  it('KnowledgeStatus values are stable', () => {
    expect(KnowledgeStatus.PROBATION).toBe('probation');
    expect(KnowledgeStatus.ACTIVE).toBe('active');
    expect(KnowledgeStatus.VERIFIED).toBe('verified');
    expect(KnowledgeStatus.DEPRECATED).toBe('deprecated');
    expect(KnowledgeStatus.OUTDATED).toBe('outdated');
  });

  it('CaptureSource values are stable', () => {
    expect(CaptureSource.GIT_HOOK).toBe('git_hook');
    expect(CaptureSource.IDE_PLUGIN).toBe('ide_plugin');
    expect(CaptureSource.CLI).toBe('cli');
    expect(CaptureSource.WEB_UI).toBe('web_ui');
    expect(CaptureSource.PR_REVIEW).toBe('pr_review');
    expect(CaptureSource.AI_CONVERSATION).toBe('ai_conversation');
    expect(CaptureSource.AUTO_DETECT).toBe('auto_detect');
    expect(CaptureSource.P4_TRIGGER).toBe('p4_trigger');
  });
});

describe('isValidKnowledgeType', () => {
  it('accepts every known enum value', () => {
    for (const v of Object.values(KnowledgeType)) {
      expect(isValidKnowledgeType(v)).toBe(true);
    }
  });

  it('rejects unknown values', () => {
    expect(isValidKnowledgeType('not_a_type')).toBe(false);
    expect(isValidKnowledgeType('')).toBe(false);
    expect(isValidKnowledgeType('Bug_Fix')).toBe(false); // case sensitive
  });

  it('narrows the type when used as a guard', () => {
    const x: string = 'bug_fix';
    if (isValidKnowledgeType(x)) {
      // Narrowed to KnowledgeType — should compile + run.
      const t: KnowledgeType = x;
      expect(t).toBe(KnowledgeType.BUG_FIX);
    } else {
      throw new Error('guard should have narrowed');
    }
  });
});
