import type {
  AssembledContext,
  CuratedContext,
  KnowledgeUnit,
  RetrievalContext,
} from '@mindstrate/protocol';
import type { ContextNode, ConflictRecord } from '@mindstrate/protocol/models';

interface DagNode<T> {
  deps?: string[];
  run: (context: DagExecutionContext) => Promise<T> | T;
}

interface DagExecutionContext {
  get<T>(nodeId: string): Promise<T>;
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
}

export interface ContextAssemblyDagDeps {
  loadSessionContext(project?: string): string | undefined;
  loadProjectSnapshot(project?: string): KnowledgeUnit | null;
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
    projectSnapshot: KnowledgeUnit | undefined,
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
          await ctx.get<KnowledgeUnit | undefined>('projectSnapshot'),
          await ctx.get<CuratedContext>('curated'),
          { includeTaskCuration: false },
        );

        const sections: string[] = [base];

        if (graphRules.length > 0) {
          sections.push('\n### Operational Rules');
          sections.push(...graphRules.slice(0, 5).map((node) => `- ${node.title}`));
        }
        if (graphPatterns.length > 0) {
          sections.push('\n### Repeated Patterns');
          sections.push(...graphPatterns.slice(0, 5).map((node) => `- ${node.title}`));
        }
        if (graphSummaries.length > 0) {
          sections.push('\n### Recent Summary Clusters');
          sections.push(...graphSummaries.slice(0, 5).map((node) => `- ${node.title}`));
        }
        if (graphConflicts.length > 0) {
          sections.push('\n### Active Conflicts');
          sections.push(...graphConflicts.slice(0, 5).map((record) => `- ${record.reason}`));
        }
        sections.push('\n### Task Curation');
        sections.push((await ctx.get<CuratedContext>('curated')).summary);

        return sections.join('\n');
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
      run: async (ctx) => ({
        taskDescription: input.taskDescription,
        project: await ctx.get<string | undefined>('project'),
        sessionContext: await ctx.get<string | undefined>('sessionContext'),
        projectSnapshot: await ctx.get<KnowledgeUnit | undefined>('projectSnapshot'),
        graphSummaries: (await ctx.get<ContextNode[]>('graphSummaries')).map((node) => node.title),
        graphPatterns: (await ctx.get<ContextNode[]>('graphPatterns')).map((node) => node.title),
        graphRules: (await ctx.get<ContextNode[]>('graphRules')).map((node) => node.title),
        graphConflicts: (await ctx.get<ConflictRecord[]>('graphConflicts')).map((record) => record.reason),
        curated: await ctx.get<CuratedContext>('curated'),
        summary: await ctx.get<string>('summary'),
      } satisfies AssembledContext),
    },
  };

  const executor = new DagExecutor(nodes);
  const { value, executionOrder } = await executor.run<AssembledContext>('assembled');
  return {
    assembled: value,
    executionOrder,
  };
}
