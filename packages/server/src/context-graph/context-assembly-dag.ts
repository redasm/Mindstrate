import type {
  AssembledContext,
  CuratedContext,
  RetrievalContext,
} from '@mindstrate/protocol';
import { SubstrateType, type ContextNode, type ConflictRecord } from '@mindstrate/protocol/models';

interface DagNode<T> {
  deps?: string[];
  run: (context: DagExecutionContext) => Promise<T> | T;
}

interface DagExecutionContext {
  get<T>(nodeId: string): Promise<T>;
}

interface SummarySection {
  priority: number;
  content: string;
}

class DagExecutor {
  private readonly nodes: Record<string, DagNode<unknown>>;
  private readonly cache = new Map<string, Promise<unknown>>();
  private readonly active = new Set<string>();
  private readonly executionOrder: string[] = [];

  constructor(nodes: Record<string, DagNode<unknown>>) {
    this.nodes = nodes;
  }

  async run<T>(target: string): Promise<{ value: T; executionOrder: string[] }> {
    const value = await this.resolve<T>(target);
    return { value, executionOrder: [...this.executionOrder] };
  }

  private resolve<T>(nodeId: string): Promise<T> {
    const cached = this.cache.get(nodeId);
    if (cached) {
      return cached as Promise<T>;
    }

    const node = this.nodes[nodeId];
    if (!node) {
      throw new Error(`Unknown DAG node: ${nodeId}`);
    }
    if (this.active.has(nodeId)) {
      throw new Error(`Cycle detected while resolving DAG node: ${nodeId}`);
    }

    this.active.add(nodeId);
    const promise = (async () => {
      try {
        for (const dep of node.deps ?? []) {
          await this.resolve(dep);
        }
        const value = await node.run({
          get: <R>(depId: string) => this.resolve<R>(depId),
        });
        this.executionOrder.push(nodeId);
        return value;
      } finally {
        this.active.delete(nodeId);
      }
    })();

    this.cache.set(nodeId, promise);
    return promise as Promise<T>;
  }
}

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
    curated: {
      deps: ['context'],
      run: async (ctx) => {
        const context = await ctx.get<RetrievalContext | undefined>('context');
        return deps.curateContext(input.taskDescription, context, input.sessionId);
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
        'curated',
      ],
      run: async (ctx) => {
        const graphSummaries = await ctx.get<ContextNode[]>('graphSummaries');
        const graphPatterns = await ctx.get<ContextNode[]>('graphPatterns');
        const graphRules = await ctx.get<ContextNode[]>('graphRules');
        const graphConflicts = await ctx.get<ConflictRecord[]>('graphConflicts');
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

function formatSummarySection(title: string, items: string[]): string {
  return [`\n### ${title}`, ...items.map((item) => `- ${item}`)].join('\n');
}

function clipSummaryByBudget(
  base: string,
  sections: SummarySection[],
  maxCharacters: number,
): string {
  if (maxCharacters <= 0) return '';

  const candidates = [
    ...sections,
    { priority: 30, content: base },
  ];
  const selected = candidates
    .slice()
    .sort((a, b) => b.priority - a.priority)
    .reduce<string[]>((acc, section) => {
      const candidate = [...acc, section.content].join('\n');
      if (candidate.length <= maxCharacters) {
        return [...acc, section.content];
      }
      return acc;
    }, []);

  const summary = [
    ...selected.filter((section) => section === base),
    ...selected.filter((section) => section !== base),
  ].join('\n');
  if (summary.length <= maxCharacters) {
    return summary;
  }
  return `${summary.slice(0, Math.max(maxCharacters - 1, 0))}…`;
}

function buildEvidenceTrail(
  project: string | undefined,
  sessionContext: string | undefined,
  projectSnapshot: ContextNode | undefined,
  graphRules: ContextNode[],
  graphPatterns: ContextNode[],
  graphSummaries: ContextNode[],
  graphConflicts: ConflictRecord[],
): string[] {
  const trail: string[] = [];
  if (sessionContext) {
    trail.push(`session:${project ?? 'default'}`);
  }
  if (projectSnapshot) {
    trail.push(`project-snapshot:${projectSnapshot.id}`);
  }
  trail.push(...graphRules.map((node) => `rule:${node.id}`));
  trail.push(...graphPatterns.map((node) => `pattern:${node.id}`));
  trail.push(...graphSummaries.map((node) => `summary:${node.id}`));
  trail.push(...graphConflicts.map((record) => `conflict:${record.id}`));
  return trail;
}
