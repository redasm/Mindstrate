import type {
  AssembledContext,
  ConflictRecord,
  ContextDomainType,
  ContextEdge,
  ContextEventType,
  ContextNode,
  ContextNodeStatus,
  CuratedContext,
  GraphKnowledgeSearchResult,
  GraphKnowledgeView,
  InstallBundleResult,
  PortableContextBundle,
  ProjectionRecord,
  ProjectGraphOverlay,
  ProjectGraphOverlayKind,
  ProjectGraphOverlaySource,
} from '@mindstrate/protocol';
import { TeamDomainClient } from './team-domain-client.js';

export type InternalizationTarget = 'agents_md' | 'project_snapshot' | 'system_prompt' | 'fine_tune_dataset';

export interface ObsidianProjectionWriteResult {
  files: string[];
}

export interface ObsidianProjectionImportResult {
  sourceNodeId?: string;
  candidateNode?: unknown;
  event?: unknown;
  changed: boolean;
}

export class ContextClient extends TeamDomainClient {
  async curate(task: string, context?: { currentLanguage?: string; currentFramework?: string }): Promise<CuratedContext> {
    return this.post('/api/curate', {
      task,
      language: context?.currentLanguage,
      framework: context?.currentFramework,
    });
  }

  async assemble(
    task: string,
    options?: {
      project?: string;
      context?: { currentLanguage?: string; currentFramework?: string; project?: string };
      sessionId?: string;
    },
  ): Promise<AssembledContext> {
    return this.post('/api/context/assemble', {
      task,
      project: options?.project ?? options?.context?.project,
      language: options?.context?.currentLanguage,
      framework: options?.context?.currentFramework,
      sessionId: options?.sessionId,
    });
  }

  async readKnowledge(options?: { project?: string; limit?: number }): Promise<GraphKnowledgeView[]> {
    const params = new URLSearchParams();
    if (options?.project) params.set('project', options.project);
    if (options?.limit) params.set('limit', String(options.limit));

    const data = await this.fetch<{ entries?: GraphKnowledgeView[] }>(`/api/graph/knowledge?${params}`);
    return data.entries ?? [];
  }

  async queryKnowledge(
    query: string,
    options?: { project?: string; topK?: number; limit?: number; sessionId?: string },
  ): Promise<GraphKnowledgeSearchResult[]> {
    return this.post('/api/graph/search', {
      query,
      project: options?.project,
      topK: options?.topK,
      limit: options?.limit,
      sessionId: options?.sessionId,
    });
  }

  async ingestEvent(input: {
    type: ContextEventType;
    content: string;
    project?: string;
    sessionId?: string;
    actor?: string;
    domainType?: ContextDomainType;
    substrateType?: string;
    title?: string;
    tags?: string[];
    metadata?: Record<string, unknown>;
  }): Promise<{ eventId: string; nodeId: string }> {
    return this.post('/api/context/events', input);
  }

  async queryGraph(options?: {
    query?: string;
    project?: string;
    substrateType?: string;
    domainType?: ContextDomainType;
    status?: ContextNodeStatus;
    limit?: number;
  }): Promise<ContextNode[]> {
    const params = new URLSearchParams();
    if (options?.query) params.set('query', options.query);
    if (options?.project) params.set('project', options.project);
    if (options?.substrateType) params.set('substrateType', options.substrateType);
    if (options?.domainType) params.set('domainType', options.domainType);
    if (options?.status) params.set('status', options.status);
    if (options?.limit) params.set('limit', String(options.limit));

    const data = await this.fetch<{ nodes?: ContextNode[] }>(`/api/context/graph?${params}`);
    return data.nodes ?? [];
  }

  async listConflicts(options?: { project?: string; limit?: number }): Promise<ConflictRecord[]> {
    const params = new URLSearchParams();
    if (options?.project) params.set('project', options.project);
    if (options?.limit) params.set('limit', String(options.limit));

    const data = await this.fetch<{ conflicts?: ConflictRecord[] }>(`/api/context/conflicts?${params}`);
    return data.conflicts ?? [];
  }

  async listProjectionRecords(options?: {
    nodeId?: string;
    target?: string;
    limit?: number;
  }): Promise<ProjectionRecord[]> {
    const params = new URLSearchParams();
    if (options?.nodeId) params.set('nodeId', options.nodeId);
    if (options?.target) params.set('target', options.target);
    if (options?.limit) params.set('limit', String(options.limit));

    const data = await this.fetch<{ records?: ProjectionRecord[] }>(`/api/context/projections?${params}`);
    return data.records ?? [];
  }

  async acceptConflictCandidate(input: {
    conflictId: string;
    candidateNodeId: string;
    resolution: string;
  }): Promise<{ resolved: ConflictRecord | null }> {
    return this.post('/api/context/conflicts/accept', input);
  }

  async rejectConflictCandidate(input: {
    conflictId: string;
    candidateNodeId: string;
    reason: string;
  }): Promise<{ rejected: boolean }> {
    return this.post('/api/context/conflicts/reject', input);
  }

  async listEdges(options?: {
    sourceId?: string;
    targetId?: string;
    relationType?: string;
    limit?: number;
  }): Promise<ContextEdge[]> {
    const params = new URLSearchParams();
    if (options?.sourceId) params.set('sourceId', options.sourceId);
    if (options?.targetId) params.set('targetId', options.targetId);
    if (options?.relationType) params.set('relationType', options.relationType);
    if (options?.limit) params.set('limit', String(options.limit));

    const data = await this.fetch<{ edges?: ContextEdge[] }>(`/api/context/edges?${params}`);
    return data.edges ?? [];
  }

  async writeObsidianProjectionFiles(options: {
    rootDir: string;
    project?: string;
    limit?: number;
  }): Promise<ObsidianProjectionWriteResult> {
    return this.post('/api/context/obsidian-projection/write', options);
  }

  async importObsidianProjectionFile(filePath: string): Promise<ObsidianProjectionImportResult> {
    return this.post('/api/context/obsidian-projection/import', { filePath });
  }

  async publishProjectGraph(input: {
    bundle: PortableContextBundle;
    repoId: string;
  }): Promise<InstallBundleResult> {
    return this.post('/api/context/project-graph/publish', input);
  }

  async createProjectGraphOverlay(input: {
    project: string;
    target?: string;
    targetNodeId?: string;
    targetEdgeId?: string;
    kind: ProjectGraphOverlayKind;
    content: string;
    author?: string;
    source: ProjectGraphOverlaySource;
  }): Promise<ProjectGraphOverlay> {
    return this.post('/api/context/project-graph/overlays', input);
  }

  async listProjectGraphOverlays(options?: {
    project?: string;
    targetNodeId?: string;
    targetEdgeId?: string;
    limit?: number;
  }): Promise<ProjectGraphOverlay[]> {
    const params = new URLSearchParams();
    if (options?.project) params.set('project', options.project);
    if (options?.targetNodeId) params.set('targetNodeId', options.targetNodeId);
    if (options?.targetEdgeId) params.set('targetEdgeId', options.targetEdgeId);
    if (options?.limit) params.set('limit', String(options.limit));

    const data = await this.fetch<{ overlays?: ProjectGraphOverlay[] }>(
      `/api/context/project-graph/overlays?${params}`,
    );
    return data.overlays ?? [];
  }
}
