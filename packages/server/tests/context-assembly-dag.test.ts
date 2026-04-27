import { describe, expect, it } from 'vitest';
import type { CuratedContext, RetrievalContext } from '@mindstrate/protocol';
import type { ConflictRecord, ContextNode } from '@mindstrate/protocol/models';
import { runContextAssemblyDag } from '../src/context-graph/context-assembly-dag.js';

function makeProjectSnapshot(project: string): ContextNode {
  const now = '2026-04-23T00:00:00.000Z';
  return {
    id: 'snapshot-1',
    substrateType: 'snapshot',
    domainType: 'project_snapshot',
    title: 'Project Snapshot',
    content: 'Stable project substrate',
    tags: ['project-snapshot'],
    project,
    compressionLevel: 0.01,
    confidence: 1,
    qualityScore: 90,
    status: 'verified',
    metadata: {
      author: 'tester',
    },
    createdAt: now,
    updatedAt: now,
    accessCount: 0,
    positiveFeedback: 0,
    negativeFeedback: 0,
  };
}

function makeGraphNode(id: string, title: string): ContextNode {
  const now = '2026-04-23T00:00:00.000Z';
  return {
    id,
    substrateType: 'rule',
    domainType: 'convention',
    title,
    content: title,
    tags: [],
    compressionLevel: 0.01,
    confidence: 1,
    qualityScore: 80,
    status: 'active',
    createdAt: now,
    updatedAt: now,
    accessCount: 0,
    positiveFeedback: 0,
    negativeFeedback: 0,
  };
}

function makeConflict(reason: string): ConflictRecord {
  return {
    id: 'conflict-1',
    nodeIds: ['a', 'b'],
    reason,
    detectedAt: '2026-04-23T00:00:00.000Z',
  };
}

describe('runContextAssemblyDag', () => {
  it('assembles the same public shape while executing through a DAG', async () => {
    const calls: string[] = [];
    const curated: CuratedContext = {
      taskDescription: 'fix hydration mismatch',
      knowledge: [],
      workflows: [],
      warnings: [],
      summary: 'Curated task context',
    };

    const result = await runContextAssemblyDag(
      {
        taskDescription: 'fix hydration mismatch',
        project: 'mindstrate',
        context: {
          currentLanguage: 'typescript',
          currentFramework: 'react',
        },
      },
      {
        loadSessionContext(project) {
          calls.push(`session:${project}`);
          return 'Prior session context';
        },
        loadProjectSnapshot(project) {
          calls.push(`snapshot:${project}`);
          return project ? makeProjectSnapshot(project) : null;
        },
        loadGraphSummaries() {
          calls.push('graphSummaries');
          return [makeGraphNode('summary-1', 'Summary Node')];
        },
        loadGraphPatterns() {
          calls.push('graphPatterns');
          return [makeGraphNode('pattern-1', 'Pattern Node')];
        },
        loadGraphRules() {
          calls.push('graphRules');
          return [makeGraphNode('rule-1', 'Rule Node')];
        },
        loadGraphConflicts() {
          calls.push('graphConflicts');
          return [makeConflict('Hydration rules disagree')];
        },
        async curateContext(taskDescription, context, sessionId) {
          calls.push(`curate:${taskDescription}:${context?.project}:${sessionId ?? 'none'}`);
          return curated;
        },
        formatSummary(taskDescription, project, sessionContext, projectSnapshot, assembledCurated, options) {
          calls.push(`summary:${project}`);
          expect(options?.includeTaskCuration).toBe(false);
          return [
            taskDescription,
            project,
            sessionContext,
            projectSnapshot?.title,
            assembledCurated.summary,
          ].join(' | ');
        },
      },
    );

    expect(result.assembled.project).toBe('mindstrate');
    expect(result.assembled.sessionContext).toBe('Prior session context');
    expect(result.assembled.projectSnapshot?.tags).toContain('project-snapshot');
    expect(result.assembled.graphSummaries).toEqual(['Summary Node']);
    expect(result.assembled.graphPatterns).toEqual(['Pattern Node']);
    expect(result.assembled.graphRules).toEqual(['Rule Node']);
    expect(result.assembled.graphConflicts).toEqual(['Hydration rules disagree']);
    expect(result.assembled.sessionContinuity).toEqual({
      project: 'mindstrate',
      content: 'Prior session context',
    });
    expect(result.assembled.projectSubstrate).toEqual({
      project: 'mindstrate',
      snapshotTitle: 'Project Snapshot',
      snapshot: makeProjectSnapshot('mindstrate'),
    });
    expect(result.assembled.taskRelevantPatterns).toEqual(['Pattern Node', 'Summary Node']);
    expect(result.assembled.applicableSkills).toEqual([]);
    expect(result.assembled.activeRules).toEqual(['Rule Node']);
    expect(result.assembled.knownConflicts).toEqual(['Hydration rules disagree']);
    expect(result.assembled.warnings).toEqual([]);
    expect(result.assembled.evidenceTrail).toEqual([
      'session:mindstrate',
      'project-snapshot:snapshot-1',
      'rule:rule-1',
      'pattern:pattern-1',
      'summary:summary-1',
      'conflict:conflict-1',
    ]);
    expect(result.assembled.curated).toBe(curated);
    expect(result.assembled.summary).toContain('Curated task context');
    expect(result.assembled.summary).toContain('Operational Rules');
    expect(result.assembled.summary).toContain('Active Conflicts');
    expect(result.assembled.summary).toContain('Task Curation');
    expect(result.executionOrder).toEqual([
      'project',
      'sessionContext',
      'projectSnapshot',
      'graphSummaries',
      'graphPatterns',
      'graphRules',
      'graphConflicts',
      'context',
      'curated',
      'summary',
      'assembled',
    ]);
    expect(calls).toEqual([
      'session:mindstrate',
      'snapshot:mindstrate',
      'graphSummaries',
      'graphPatterns',
      'graphRules',
      'graphConflicts',
      'curate:fix hydration mismatch:mindstrate:none',
      'summary:mindstrate',
    ]);
  });

  it('gracefully handles missing project and context', async () => {
    const result = await runContextAssemblyDag(
      {
        taskDescription: 'brand new task',
      },
      {
        loadSessionContext() {
          return undefined;
        },
        loadProjectSnapshot() {
          return null;
        },
        loadGraphSummaries() {
          return [];
        },
        loadGraphPatterns() {
          return [];
        },
        loadGraphRules() {
          return [];
        },
        loadGraphConflicts() {
          return [];
        },
        async curateContext(taskDescription, context) {
          expect(taskDescription).toBe('brand new task');
          expect(context).toBeUndefined();
          return {
            taskDescription,
            knowledge: [],
            workflows: [],
            warnings: [],
            summary: 'No context found',
          };
        },
        formatSummary(taskDescription, _project, _sessionContext, _projectSnapshot, _curated, options) {
          expect(options?.includeTaskCuration).toBe(false);
          return `Working Context for: ${taskDescription}`;
        },
      },
    );

    expect(result.assembled.project).toBeUndefined();
    expect(result.assembled.sessionContext).toBeUndefined();
    expect(result.assembled.projectSnapshot).toBeUndefined();
    expect(result.assembled.summary).toContain('Working Context for: brand new task');
  });

  it('clips assembled summary by budget while preserving conflicts and rules', async () => {
    const result = await runContextAssemblyDag(
      {
        taskDescription: 'ship within context budget',
        project: 'mindstrate',
        maxSummaryCharacters: 180,
      },
      {
        loadSessionContext() {
          return 'Long session context that should be compressed away first.';
        },
        loadProjectSnapshot() {
          return makeProjectSnapshot('mindstrate');
        },
        loadGraphSummaries() {
          return [makeGraphNode('summary-1', 'Low priority summary '.repeat(10))];
        },
        loadGraphPatterns() {
          return [makeGraphNode('pattern-1', 'Lower priority pattern '.repeat(10))];
        },
        loadGraphRules() {
          return [makeGraphNode('rule-1', 'Must run focused tests')];
        },
        loadGraphConflicts() {
          return [makeConflict('Active conflict must stay visible')];
        },
        async curateContext(taskDescription) {
          return {
            taskDescription,
            knowledge: [],
            workflows: [],
            warnings: [],
            summary: 'Curated details '.repeat(20),
          };
        },
        formatSummary() {
          return 'Base summary '.repeat(20);
        },
      },
    );

    expect(result.assembled.summary.length).toBeLessThanOrEqual(180);
    expect(result.assembled.summary).toContain('Active conflict must stay visible');
    expect(result.assembled.summary).toContain('Must run focused tests');
    expect(result.assembled.summary).not.toContain('Low priority summary');
  });
});
