import type {
  AssembledContext,
  AssembledRetrieval,
  CuratedContext,
  GraphKnowledgeSearchResult,
  ProjectGraphContextFact,
  RetrievalContext,
} from '@mindstrate/protocol';
import {
  ContextDomainType,
  PROJECT_GRAPH_DEFAULT_QUERY_LIMIT,
  SubstrateType,
  type ConflictRecord,
  type ContextNode,
} from '@mindstrate/protocol/models';
import { runContextAssemblyDag } from '../context-graph/context-assembly-dag.js';
import { generateGraphCurationSummary } from '../context-graph/graph-curation-summary.js';
import { selectProjectGraphAssemblyFacts } from '../context-graph/project-graph-assembly-selector.js';
import type { MindstrateRuntime } from './mindstrate-runtime.js';

export class MindstrateContextAssemblyApi {
  constructor(
    private readonly services: MindstrateRuntime,
    private readonly ensureInit: () => Promise<void>,
    private readonly loadSessionContext: (project?: string) => string,
    private readonly queryGraphKnowledge: (query: string, options?: { project?: string; limit?: number }) => GraphKnowledgeSearchResult[],
    private readonly listConflictRecords: (project?: string, limit?: number) => ConflictRecord[],
  ) {}

  async curateContext(
    taskDescription: string,
    context?: RetrievalContext,
    _sessionId?: string,
  ): Promise<CuratedContext> {
    await this.ensureInit();
    const project = context?.project;
    const graphSelection = this.services.contextPrioritySelector.select({
      project,
      perLayerLimit: 5,
    });
    const conflicts = this.listConflictRecords(project, 5);
    const knowledge = this.queryGraphKnowledge(taskDescription, { project, limit: 5 });
    const workflows = this.queryGraphKnowledge(taskDescription, { project, limit: 10 })
      .filter((result) => result.view.domainType === ContextDomainType.WORKFLOW)
      .slice(0, 3);
    const warnings = this.queryGraphKnowledge(`common mistakes pitfalls when ${taskDescription}`, {
      project,
      limit: 3,
    });
    const sections = this.formatCurationSections(
      taskDescription,
      graphSelection,
      conflicts,
      knowledge,
      workflows,
      warnings,
    );

    return {
      taskDescription,
      knowledge,
      workflows,
      warnings,
      graphRules: graphSelection.rules.map((node) => node.title),
      graphPatterns: graphSelection.patterns.map((node) => node.title),
      graphSummaries: graphSelection.summaries.map((node) => node.title),
      graphConflicts: conflicts.map((record) => record.reason),
      summary: sections.join('\n'),
    };
  }

  async assembleContext(
    taskDescription: string,
    options?: {
      project?: string;
      context?: RetrievalContext;
      sessionId?: string;
      maxSummaryCharacters?: number;
    },
  ): Promise<AssembledContext> {
    await this.ensureInit();
    const queryEmbedding = await this.services.embedder.embed(taskDescription);
    const graphSelection = this.services.contextPrioritySelector.select({
      project: options?.project ?? options?.context?.project,
      context: options?.context,
      queryEmbedding,
      embeddingModel: this.services.config.embeddingModel,
      perLayerLimit: 5,
    });
    const result = await runContextAssemblyDag(
      {
        taskDescription,
        project: options?.project,
        context: options?.context,
        sessionId: options?.sessionId,
        maxSummaryCharacters: options?.maxSummaryCharacters,
      },
      {
        loadSessionContext: (project) => project ? this.loadSessionContext(project) || undefined : undefined,
        loadProjectSnapshot: (project) => project ? this.findProjectSnapshot(project) : null,
        loadGraphSummaries: () => graphSelection.summaries,
        loadGraphPatterns: () => graphSelection.patterns,
        loadGraphRules: () => graphSelection.rules,
        loadGraphConflicts: (project) => this.listConflictRecords(project, 10),
        loadProjectGraphFacts: (task, project, retrievalContext) =>
          this.loadProjectGraphFacts(task, project, retrievalContext),
        trackAssemblyRetrievals: (entries, task, sessionId) =>
          this.trackAssemblyRetrievals(entries, task, sessionId),
        curateContext: (task, context, sessionId) => this.curateContext(task, context, sessionId),
        formatSummary: (
          task,
          project,
          sessionContext,
          projectSnapshot,
          curated,
          summaryOptions,
        ) => this.formatAssembledContext(
          task,
          project,
          sessionContext,
          projectSnapshot,
          curated,
          summaryOptions,
        ),
      },
    );

    return result.assembled;
  }

  assembleWorkingContext(
    taskDescription: string,
    options?: {
      project?: string;
      context?: RetrievalContext;
      sessionId?: string;
      maxSummaryCharacters?: number;
    },
  ): Promise<AssembledContext> {
    return this.assembleContext(taskDescription, options);
  }

  private formatCurationSections(
    taskDescription: string,
    graphSelection: {
      rules: ContextNode[];
      patterns: ContextNode[];
      summaries: ContextNode[];
    },
    conflicts: ConflictRecord[],
    knowledge: GraphKnowledgeSearchResult[],
    workflows: GraphKnowledgeSearchResult[],
    warnings: GraphKnowledgeSearchResult[],
  ): string[] {
    const sections: string[] = [`## Context for: ${taskDescription}`];
    this.appendTitles(sections, 'Operational Rules', graphSelection.rules);
    this.appendTitles(sections, 'Repeated Patterns', graphSelection.patterns);
    this.appendTitles(sections, 'Recent Summary Clusters', graphSelection.summaries);
    if (conflicts.length > 0) {
      sections.push('\n### Active Conflicts');
      sections.push(...conflicts.map((record) => `- ${record.reason}`));
    }
    sections.push('\n### Task Curation');
    sections.push(generateGraphCurationSummary(taskDescription, knowledge, workflows, warnings));
    return sections;
  }

  private appendTitles(sections: string[], title: string, nodes: ContextNode[]): void {
    if (nodes.length === 0) return;
    sections.push(`\n### ${title}`);
    sections.push(...nodes.map((node) => `- ${node.title}`));
  }

  private findProjectSnapshot(project: string): ContextNode | null {
    return this.services.contextGraphStore.listNodes({
      project,
      substrateType: SubstrateType.SNAPSHOT,
      domainType: ContextDomainType.PROJECT_SNAPSHOT,
      limit: 1,
    })[0] ?? null;
  }

  /**
   * Pull project graph relationship facts for the assembled context. Loads
   * the project-scoped subset of project graph nodes + edges (capped at
   * `PROJECT_GRAPH_DEFAULT_QUERY_LIMIT`) and delegates the seed selection
   * + 1-hop expansion to `selectProjectGraphAssemblyFacts`.
   *
   * Returns `[]` when no project is in scope; the upstream summary
   * formatter then drops the section entirely instead of emitting an
   * empty header.
   */
  private loadProjectGraphFacts(
    taskDescription: string,
    project: string | undefined,
    retrievalContext: RetrievalContext | undefined,
  ): ProjectGraphContextFact[] {
    if (!project) return [];
    const nodes = this.services.contextGraphStore.listNodes({
      project,
      domainType: ContextDomainType.ARCHITECTURE,
      limit: PROJECT_GRAPH_DEFAULT_QUERY_LIMIT,
    });
    if (nodes.length === 0) return [];
    const edges = this.services.contextGraphStore.listEdges({
      limit: PROJECT_GRAPH_DEFAULT_QUERY_LIMIT,
    });
    return selectProjectGraphAssemblyFacts({
      nodes,
      edges,
      taskDescription,
      context: retrievalContext,
    }).facts;
  }

  /**
   * Mint a feedback retrieval ticket for every node we surfaced in the
   * assembled context. The AI then closes the loop via
   * `mindstrate_memory_feedback_auto({ retrievalId, signal })`, which
   * lets `feedbackLoop.applyFeedbackToNode` increment
   * positive / negative feedback counts that downstream selectors use
   * for ranking. Without this step, the priority selector's feedback
   * fields stay flat regardless of how the AI actually used the
   * surfaced knowledge.
   */
  private trackAssemblyRetrievals(
    entries: Array<{ nodeId: string; origin: AssembledRetrieval['origin'] }>,
    taskDescription: string,
    sessionId: string | undefined,
  ): AssembledRetrieval[] {
    const result: AssembledRetrieval[] = [];
    for (const entry of entries) {
      try {
        const retrievalId = this.services.feedbackLoop.trackRetrieval(
          entry.nodeId,
          taskDescription,
          sessionId,
        );
        result.push({ retrievalId, nodeId: entry.nodeId, origin: entry.origin });
      } catch {
        // A missing-node insert from a foreign-key violation just means
        // the surfaced node was already removed mid-assembly. Skip
        // silently rather than fail the whole assembly call.
      }
    }
    return result;
  }

  private formatAssembledContext(
    taskDescription: string,
    project: string | undefined,
    sessionContext: string | undefined,
    projectSnapshot: ContextNode | undefined,
    curated: CuratedContext,
    options?: {
      includeTaskCuration?: boolean;
    },
  ): string {
    const sections: string[] = [`## Working Context for: ${taskDescription}`];
    if (project) sections.push(`Project: ${project}`);
    if (sessionContext) sections.push('\n### Session Continuity', sessionContext);
    if (projectSnapshot) {
      sections.push('\n### Project Snapshot', `Title: ${projectSnapshot.title}`, projectSnapshot.content);
    }
    if (options?.includeTaskCuration !== false) {
      sections.push('\n### Task Curation', curated.summary);
    }
    return sections.join('\n').trim();
  }
}

