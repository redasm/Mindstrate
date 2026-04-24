import { describe, expect, it } from 'vitest';
import {
  ContextDomainType,
  ContextEventType,
  ContextNodeStatus,
  ContextRelationType,
  SubstrateType,
  isValidContextDomainType,
  isValidContextEventType,
  isValidContextNodeStatus,
  isValidContextRelationType,
  isValidSubstrateType,
} from '../src/models/context-graph.js';
import {
  MetabolismRunStatus,
  MetabolismStage,
  ProjectionTarget,
} from '../src/models/metabolism.js';

describe('ECS enum stability', () => {
  it('SubstrateType values are stable', () => {
    expect(Object.values(SubstrateType)).toEqual([
      'episode',
      'snapshot',
      'summary',
      'pattern',
      'skill',
      'rule',
      'heuristic',
      'axiom',
    ]);
  });

  it('ContextDomainType values are stable', () => {
    expect(Object.values(ContextDomainType).sort()).toEqual([
      'architecture',
      'best_practice',
      'bug_fix',
      'context_event',
      'convention',
      'gotcha',
      'how_to',
      'pattern',
      'project_snapshot',
      'session_summary',
      'troubleshooting',
      'workflow',
    ]);
  });

  it('ContextNodeStatus values are stable', () => {
    expect(Object.values(ContextNodeStatus)).toEqual([
      'candidate',
      'active',
      'verified',
      'deprecated',
      'archived',
      'conflicted',
    ]);
  });

  it('ContextRelationType values are stable', () => {
    expect(Object.values(ContextRelationType)).toEqual([
      'follows',
      'causes',
      'supports',
      'contradicts',
      'generalizes',
      'instantiates',
      'derived_from',
      'applies_to',
      'depends_on',
      'observed_in',
    ]);
  });

  it('ContextEventType values are stable', () => {
    expect(Object.values(ContextEventType)).toEqual([
      'session_observation',
      'knowledge_write',
      'project_snapshot',
      'feedback_signal',
      'tool_result',
      'test_result',
      'git_activity',
      'lsp_diagnostic',
      'user_edit',
      'metabolic_output',
    ]);
  });

  it('metabolism and projection enums are stable', () => {
    expect(Object.values(MetabolismStage)).toEqual([
      'digest',
      'assimilate',
      'compress',
      'prune',
      'reflect',
    ]);
    expect(Object.values(MetabolismRunStatus)).toEqual([
      'running',
      'completed',
      'failed',
      'cancelled',
    ]);
    expect(Object.values(ProjectionTarget)).toEqual([
      'graph_knowledge',
      'session_summary',
      'project_snapshot',
      'obsidian_document',
    ]);
  });
});

describe('ECS value guards', () => {
  it('accepts known values', () => {
    expect(isValidSubstrateType('episode')).toBe(true);
    expect(isValidContextDomainType('project_snapshot')).toBe(true);
    expect(isValidContextNodeStatus('conflicted')).toBe(true);
    expect(isValidContextRelationType('derived_from')).toBe(true);
    expect(isValidContextEventType('tool_result')).toBe(true);
  });

  it('rejects unknown values', () => {
    expect(isValidSubstrateType('Episode')).toBe(false);
    expect(isValidContextDomainType('rule')).toBe(false);
    expect(isValidContextNodeStatus('outdated')).toBe(false);
    expect(isValidContextRelationType('caused_by')).toBe(false);
    expect(isValidContextEventType('session-save')).toBe(false);
  });
});
