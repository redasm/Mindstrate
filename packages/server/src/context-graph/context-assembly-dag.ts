import type {
  AssembledContext,
  AssembledRetrieval,
  CuratedContext,
  ProjectGraphContextFact,
  RetrievalContext,
} from '@mindstrate/protocol';
import { SubstrateType, type ContextNode, type ConflictRecord } from '@mindstrate/protocol/models';
import {
  buildEvidenceTrail,
  clipSummaryByBudget,
  formatSummarySection,
  type SummarySection,
} from './context-assembly-format.js';
import { DagExecutor, type DagNode } from './dag-executor.js';

export interface ContextAssemblyDagInput {
  taskDescription: string;
  project?: string;
  context?: RetrievalContext;
  sessionId?: string;
  maxSummaryCharacters?: number;
}

export interface ContextAssemblyDagDeps {
  loadSessionContext(project?: string): string | undefined;
  loadProjectSnapshot(project?: string): ContextNode | null;
  loadGraphSummaries(project?: string): ContextNode[];
  loadGraphPatterns(project?: string): ContextNode[];
  loadGraphRules(project?: string): ContextNode[];
  loadGraphConflicts(project?: string): ConflictRecord[];
  /**
   * Surface project graph relationship facts (file / module / dependency
   * / asset nodes plus 1-hop neighbors) for the assembled context.
   * Returning an empty array is fine when the project has no graph yet
   * or when nothing matched the seed selection.
   */
  loadProjectGraphFacts(
    taskDescription: string,
    project: string | undefined,
    context: RetrievalContext | undefined,
  ): ProjectGraphContextFact[];
  /**
   * Mint feedback retrieval IDs for every node we are about to surface,
   * so the AI can later report which were actually used. Returning an
   * empty array disables the loop (e.g. in tests with no DB).
   */
  trackAssemblyRetrievals(
    nodes: Array<{
      nodeId: string;
      origin: AssembledRetrieval['origin'];
    }>,
    taskDescription: string,
    sessionId: string | undefined,
  ): AssembledRetrieval[];
  curateContext(
    taskDescription: string,
    context?: RetrievalContext,
    sessionId?: string,
  ): Promise<CuratedContext>;
  formatSummary(
    taskDescription: string,
    project: string | undefined,
    sessionContext: string | undefined,
    projectSnapshot: ContextNode | undefined,
    curated: CuratedContext,
    options?: {
      includeTaskCuration?: boolean;
    },
  ): string;
}

export interface ContextAssemblyDagResult {
  assembled: AssembledContext;
  executionOrder: string[];
}

export async function runContextAssemblyDag(
  input: ContextAssemblyDagInput,
  deps: ContextAssemblyDagDeps,
): Promise<ContextAssemblyDagResult> {
  const nodes: Record<string, DagNode<unknown>> = {
    project: {
      run: () => input.project ?? input.context?.project ?? undefined,
    },
    context: {
      deps: ['project'],
      run: async (ctx) => {
        const project = await ctx.get<string | undefined>('project');
        if (!input.context) {
          return project ? { project } satisfies RetrievalContext : undefined;
        }

        return {
          ...input.context,
          project: project ?? input.context.project,
        } satisfies RetrievalContext;
      },
    },
    sessionContext: {
      deps: ['project'],
      run: async (ctx) => {
        const project = await ctx.get<string | undefined>('project');
        return project ? deps.loadSessionContext(project) : undefined;
      },
    },
    projectSnapshot: {
      deps: ['project'],
      run: async (ctx) => {
        const project = await ctx.get<string | undefined>('project');
        return project ? deps.loadProjectSnapshot(project) ?? undefined : undefined;
      },
    },
    graphSummaries: {
      deps: ['project'],
      run: async (ctx) => {
        const project = await ctx.get<string | undefined>('project');
        return deps.loadGraphSummaries(project);
      },
    },
    graphPatterns: {
      deps: ['project'],
      run: async (ctx) => {
        const project = await ctx.get<string | undefined>('project');
        return deps.loadGraphPatterns(project);
      },
    },
    graphRules: {
      deps: ['project'],
      run: async (ctx) => {
        const project = await ctx.get<string | undefined>('project');
        return deps.loadGraphRules(project);
      },
    },
    graphConflicts: {
      deps: ['project'],
      run: async (ctx) => {
        const project = await ctx.get<string | undefined>('project');
        return deps.loadGraphConflicts(project);
      },
    },
    projectGraphFacts: {
      deps: ['project', 'context'],
      run: async (ctx) => {
        const project = await ctx.get<string | undefined>('project');
        const retrievalContext = await ctx.get<RetrievalContext | undefined>('context');
        return deps.loadProjectGraphFacts(input.taskDescription, project, retrievalContext);
      },
    },
    curated: {
      deps: ['context'],
      run: async (ctx) => {
        const context = await ctx.get<RetrievalContext | undefined>('context');
        return deps.curateContext(input.taskDescription, context, input.sessionId);
      },
    },
    retrievals: {
      deps: ['graphRules', 'graphPatterns', 'graphSummaries', 'projectGraphFacts', 'curated'],
      run: async (ctx) => {
        const graphRules = await ctx.get<ContextNode[]>('graphRules');
        const graphPatterns = await ctx.get<ContextNode[]>('graphPatterns');
        const graphSummaries = await ctx.get<ContextNode[]>('graphSummaries');
        const projectGraphFacts = await ctx.get<ProjectGraphContextFact[]>('projectGraphFacts');
        const curated = await ctx.get<CuratedContext>('curated');
        const surfaced: Array<{ nodeId: string; origin: AssembledRetrieval['origin'] }> = [];
        for (const rule of graphRules) surfaced.push({ nodeId: rule.id, origin: 'graph-rule' });
        for (const pattern of graphPatterns) surfaced.push({ nodeId: pattern.id, origin: 'graph-pattern' });
        for (const summary of graphSummaries) surfaced.push({ nodeId: summary.id, origin: 'graph-summary' });
        for (const fact of projectGraphFacts) surfaced.push({ nodeId: fact.nodeId, origin: 'project-graph' });
        for (const knowledge of curated.knowledge) surfaced.push({ nodeId: knowledge.view.id, origin: 'curated-knowledge' });
        // Deduplicate while preserving the first origin we saw, so the AI's
        // back-report does not double-credit a node retrieved through two
        // overlapping channels.
        const seen = new Set<string>();
        const unique = surfaced.filter((entry) => {
          if (seen.has(entry.nodeId)) return false;
          seen.add(entry.nodeId);
          return true;
        });
        return deps.trackAssemblyRetrievals(unique, input.taskDescription, input.sessionId);
      },
    },
    summary: {
      deps: [
        'project',
        'sessionContext',
        'projectSnapshot',
        'graphSummaries',
        'graphPatterns',
        'graphRules',
        'graphConflicts',
        'projectGraphFacts',
        'curated',
      ],
      run: async (ctx) => {
        const graphSummaries = await ctx.get<ContextNode[]>('graphSummaries');
        const graphPatterns = await ctx.get<ContextNode[]>('graphPatterns');
        const graphRules = await ctx.get<ContextNode[]>('graphRules');
        const graphConflicts = await ctx.get<ConflictRecord[]>('graphConflicts');
        const projectGraphFacts = await ctx.get<ProjectGraphContextFact[]>('projectGraphFacts');
        const base = deps.formatSummary(
          input.taskDescription,
          await ctx.get<string | undefined>('project'),
          await ctx.get<string | undefined>('sessionContext'),
          await ctx.get<ContextNode | undefined>('projectSnapshot'),
          await ctx.get<CuratedContext>('curated'),
          { includeTaskCuration: false },
        );

        const sections: string[] = [base];

        const prioritizedSections: SummarySection[] = [];
        if (graphConflicts.length > 0) {
          prioritizedSections.push({
            priority: 100,
            content: formatSummarySection('Active Conflicts', graphConflicts.slice(0, 5).map((record) => record.reason)),
          });
        }
        if (graphRules.length > 0) {
          prioritizedSections.push({
            priority: 90,
            content: formatSummarySection('Operational Rules', graphRules.slice(0, 5).map((node) => node.title)),
          });
        }
        if (projectGraphFacts.length > 0) {
          prioritizedSections.push({
            priority: 70,
            content: formatSummarySection(
              'Project Graph Relationships',
              projectGraphFacts.map(formatProjectGraphFactLine),
            ),
          });
        }
        if (graphPatterns.length > 0) {
          prioritizedSections.push({
            priority: 60,
            content: formatSummarySection('Repeated Patterns', graphPatterns.slice(0, 5).map((node) => node.title)),
          });
        }
        if (graphSummaries.length > 0) {
          prioritizedSections.push({
            priority: 50,
            content: formatSummarySection('Recent Summary Clusters', graphSummaries.slice(0, 5).map((node) => node.title)),
          });
        }
        prioritizedSections.push({
          priority: 40,
          content: `\n### Task Curation\n${(await ctx.get<CuratedContext>('curated')).summary}`,
        });

        sections.push(...prioritizedSections.map((section) => section.content));
        const summary = sections.join('\n');
        return input.maxSummaryCharacters
          ? clipSummaryByBudget(base, prioritizedSections, input.maxSummaryCharacters)
          : summary;
      },
    },
    assembled: {
      deps: [
        'project',
        'sessionContext',
        'projectSnapshot',
        'graphSummaries',
        'graphPatterns',
        'graphRules',
        'graphConflicts',
        'projectGraphFacts',
        'retrievals',
        'curated',
        'summary',
      ],
      run: async (ctx) => {
        const project = await ctx.get<string | undefined>('project');
        const sessionContext = await ctx.get<string | undefined>('sessionContext');
        const projectSnapshot = await ctx.get<ContextNode | undefined>('projectSnapshot');
        const graphSummaries = await ctx.get<ContextNode[]>('graphSummaries');
        const graphPatterns = await ctx.get<ContextNode[]>('graphPatterns');
        const graphRules = await ctx.get<ContextNode[]>('graphRules');
        const graphConflicts = await ctx.get<ConflictRecord[]>('graphConflicts');
        const projectGraphFacts = await ctx.get<ProjectGraphContextFact[]>('projectGraphFacts');
        const retrievals = await ctx.get<AssembledRetrieval[]>('retrievals');
        const curated = await ctx.get<CuratedContext>('curated');

        return {
          taskDescription: input.taskDescription,
          project,
          sessionContext,
          projectSnapshot,
          graphSummaries: graphSummaries.map((node) => node.title),
          graphPatterns: graphPatterns.map((node) => node.title),
          graphRules: graphRules.map((node) => node.title),
          graphConflicts: graphConflicts.map((record) => record.reason),
          projectGraphContext: projectGraphFacts.length > 0 ? projectGraphFacts : undefined,
          retrievals: retrievals.length > 0 ? retrievals : undefined,
          sessionContinuity: sessionContext ? {
            project,
            content: sessionContext,
          } : undefined,
          projectSubstrate: project || projectSnapshot ? {
            project,
            snapshotTitle: projectSnapshot?.title,
            snapshot: projectSnapshot,
          } : undefined,
          taskRelevantPatterns: [
            ...graphPatterns.map((node) => node.title),
            ...graphSummaries.map((node) => node.title),
          ],
          applicableSkills: graphPatterns
            .filter((node) => node.substrateType === SubstrateType.SKILL)
            .map((node) => node.title),
          activeRules: graphRules.map((node) => node.title),
          knownConflicts: graphConflicts.map((record) => record.reason),
          warnings: curated.warnings.map((warning) => warning.view.title),
          evidenceTrail: buildEvidenceTrail(project, sessionContext, projectSnapshot, graphRules, graphPatterns, graphSummaries, graphConflicts),
          curated,
          summary: await ctx.get<string>('summary'),
        } satisfies AssembledContext;
      },
    },
  };

  const executor = new DagExecutor(nodes);
  const { value, executionOrder } = await executor.run<AssembledContext>('assembled');
  return {
    assembled: value,
    executionOrder,
  };
}

const formatProjectGraphFactLine = (fact: ProjectGraphContextFact): string => {
  const evidence = fact.evidence.length > 0 ? ` — evidence: ${fact.evidence.join(', ')}` : '';
  return `${fact.label} (${fact.kind})${evidence}`;
};
