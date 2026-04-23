/**
 * Mindstrate - Team Client
 *
 * HTTP 客户端，连接远程 Team Server。
 * 供 MCP Server 在 team 模式下使用，替代本地存储。
 */

import type {
  KnowledgeUnit,
  CreateKnowledgeInput,
  ConflictRecord,
  ContextDomainType,
  ContextEdge,
  ContextEventType,
  ContextNode,
  ContextNodeStatus,
  GraphKnowledgeSearchResult,
  GraphKnowledgeView,
  MetabolismRun,
  RetrievalResult,
  RetrievalFilter,
  CuratedContext,
  AssembledContext,
  SessionContext,
  Session,
  PipelineResult,
  EvolutionRunResult,
  PortableContextBundle,
} from '@mindstrate/protocol';

/** Stats returned by the team server */
export interface TeamServerStats {
  total: number;
  byType: Record<string, number>;
  byStatus: Record<string, number>;
  byLanguage: Record<string, number>;
  vectorCount: number;
  feedbackStats: {
    totalEvents: number;
    last30Days: number;
    avgAdoptionRate: number;
  };
}

/** Feedback stats for a single knowledge entry */
export interface KnowledgeFeedbackStats {
  total: number;
  adopted: number;
  rejected: number;
  ignored: number;
  partial: number;
  adoptionRate: number;
}

/** Sync result from bulk import */
export interface SyncResult {
  imported: number;
  skipped: number;
  failed: number;
}

export interface PublishBundleOptions {
  registry?: string;
  visibility?: 'public' | 'private' | 'unlisted';
}

export interface BundlePublicationManifest {
  id: string;
  name: string;
  version: string;
  registry: string;
  visibility: 'public' | 'private' | 'unlisted';
  nodeCount: number;
  edgeCount: number;
  digest: string;
  publishedAt: string;
}

export interface PublishBundleResult {
  bundle: PortableContextBundle;
  manifest: BundlePublicationManifest;
}

export interface InternalizationSuggestions {
  agentsMd: string;
  projectSnapshotFragment: string;
  systemPromptFragment: string;
  sourceNodeIds: string[];
}

export interface TeamClientConfig {
  /** Team Server URL (如 http://192.168.1.100:3388) */
  serverUrl: string;
  /** API Key */
  apiKey?: string;
  /** 请求超时（毫秒） */
  timeout?: number;
}

export class TeamClient {
  private baseUrl: string;
  private apiKey: string;
  private timeout: number;

  constructor(config: TeamClientConfig) {
    this.baseUrl = config.serverUrl.replace(/\/+$/, '');
    this.apiKey = config.apiKey ?? '';
    this.timeout = config.timeout ?? 10000;
  }

  // ============================================================
  // Knowledge
  // ============================================================

  async add(input: CreateKnowledgeInput): Promise<PipelineResult> {
    const data = await this.post<{
      success?: boolean;
      knowledge?: KnowledgeUnit;
      message?: string;
      duplicateOf?: string;
    }>('/api/knowledge', input);
    return {
      success: data.success ?? false,
      knowledge: data.knowledge,
      message: data.message ?? (data.success ? 'Added' : 'Failed'),
      duplicateOf: data.duplicateOf,
    };
  }

  /** Search knowledge on the team server. Note: only the first type in filter.types is sent. */
  async search(query: string, options?: {
    topK?: number;
    filter?: RetrievalFilter;
  }): Promise<RetrievalResult[]> {
    const data = await this.post<{ results?: RetrievalResult[] }>('/api/search', {
      query,
      topK: options?.topK ?? 5,
      language: options?.filter?.language,
      framework: options?.filter?.framework,
      project: options?.filter?.project,
      types: options?.filter?.types,
      tags: options?.filter?.tags,
      status: options?.filter?.status,
      minScore: options?.filter?.minScore,
    });
    return data.results ?? [];
  }

  async get(id: string): Promise<KnowledgeUnit | null> {
    try {
      return await this.fetch<KnowledgeUnit>(`/api/knowledge/${id}`);
    } catch (err) {
      console.warn(`[TeamClient] Failed to get knowledge ${id}: ${err instanceof Error ? err.message : String(err)}`);
      return null;
    }
  }

  /** List knowledge on the team server. Note: only the first type in filter.types is sent. */
  async list(filter?: RetrievalFilter, limit?: number): Promise<KnowledgeUnit[]> {
    const params = new URLSearchParams();
    for (const type of filter?.types ?? []) params.append('type', type);
    if (filter?.language) params.set('language', filter.language);
    if (filter?.framework) params.set('framework', filter.framework);
    if (filter?.project) params.set('project', filter.project);
    for (const tag of filter?.tags ?? []) params.append('tag', tag);
    for (const status of filter?.status ?? []) params.append('status', status);
    if (filter?.minScore !== undefined) params.set('minScore', String(filter.minScore));
    if (limit) params.set('limit', String(limit));

    const data = await this.fetch<{ entries?: KnowledgeUnit[] }>(`/api/knowledge?${params}`);
    return data.entries ?? [];
  }

  async delete(id: string): Promise<boolean> {
    try {
      await this.doFetch(`/api/knowledge/${id}`, { method: 'DELETE' });
      return true;
    } catch (err) {
      console.warn(`[TeamClient] Failed to delete knowledge ${id}: ${err instanceof Error ? err.message : String(err)}`);
      return false;
    }
  }

  async vote(id: string, direction: 'up' | 'down'): Promise<void> {
    await this.doFetch(`/api/knowledge/${id}/vote`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ direction }),
    });
  }

  // ============================================================
  // Session
  // ============================================================

  async startSession(project: string = '', techContext?: string): Promise<{ session: Session; context: string | null }> {
    return this.post('/api/session/start', { project, techContext });
  }

  async saveObservation(sessionId: string, type: string, content: string, metadata?: Record<string, string>): Promise<void> {
    await this.post('/api/session/save', { sessionId, type, content, metadata });
  }

  async endSession(sessionId: string, summary?: string, openTasks?: string[]): Promise<void> {
    await this.post('/api/session/end', { sessionId, summary, openTasks });
  }

  async restoreSession(project: string = ''): Promise<{ context: SessionContext; formatted: string | null }> {
    return this.fetch(`/api/session/restore?project=${encodeURIComponent(project)}`);
  }

  async getSession(id: string): Promise<Session | null> {
    try {
      return await this.fetch<Session>(`/api/session/${id}`);
    } catch (err) {
      console.warn(`[TeamClient] Failed to get session ${id}: ${err instanceof Error ? err.message : String(err)}`);
      return null;
    }
  }

  async getActiveSession(project: string = ''): Promise<Session | null> {
    try {
      const data = await this.fetch<{ session?: Session | null }>(`/api/session/active?project=${encodeURIComponent(project)}`);
      return data.session ?? null;
    } catch (err) {
      console.warn(`[TeamClient] Failed to get active session for ${project || '(default)'}: ${err instanceof Error ? err.message : String(err)}`);
      return null;
    }
  }

  // ============================================================
  // Stats & Sync
  // ============================================================

  async getStats(): Promise<TeamServerStats> {
    return this.fetch('/api/stats');
  }

  async sync(entries: CreateKnowledgeInput[]): Promise<SyncResult> {
    return this.post('/api/sync', { entries });
  }

  async health(): Promise<boolean> {
    try {
      const data = await this.fetch<{ status?: string }>('/health');
      return data.status === 'ok';
    } catch {
      return false;
    }
  }

  // ============================================================
  // Feedback Loop (自动反馈闭环)
  // ============================================================

  async recordFeedback(
    retrievalId: string,
    signal: 'adopted' | 'rejected' | 'ignored' | 'partial',
    context?: string,
  ): Promise<void> {
    await this.post('/api/feedback', { retrievalId, signal, context });
  }

  async getFeedbackStats(knowledgeId: string): Promise<KnowledgeFeedbackStats> {
    return this.fetch(`/api/feedback/${knowledgeId}`);
  }

  // ============================================================
  // Context Curation (上下文策划)
  // ============================================================

  async curateContext(task: string, context?: { currentLanguage?: string; currentFramework?: string }): Promise<CuratedContext> {
    return this.post('/api/curate', {
      task,
      language: context?.currentLanguage,
      framework: context?.currentFramework,
    });
  }

  async assembleContext(
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

  async readGraphKnowledge(options?: { project?: string; limit?: number }): Promise<GraphKnowledgeView[]> {
    const params = new URLSearchParams();
    if (options?.project) params.set('project', options.project);
    if (options?.limit) params.set('limit', String(options.limit));

    const data = await this.fetch<{ entries?: GraphKnowledgeView[] }>(`/api/graph/knowledge?${params}`);
    return data.entries ?? [];
  }

  async queryGraphKnowledge(
    query: string,
    options?: { project?: string; topK?: number; limit?: number },
  ): Promise<GraphKnowledgeSearchResult[]> {
    return this.post('/api/graph/search', {
      query,
      project: options?.project,
      topK: options?.topK,
      limit: options?.limit,
    });
  }

  async ingestContextEvent(input: {
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

  async queryContextGraph(options?: {
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

  async listContextConflicts(options?: { project?: string; limit?: number }): Promise<ConflictRecord[]> {
    const params = new URLSearchParams();
    if (options?.project) params.set('project', options.project);
    if (options?.limit) params.set('limit', String(options.limit));

    const data = await this.fetch<{ conflicts?: ConflictRecord[] }>(`/api/context/conflicts?${params}`);
    return data.conflicts ?? [];
  }

  async listContextEdges(options?: {
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

  async createBundle(options: {
    name: string;
    version?: string;
    description?: string;
    project?: string;
    nodeIds?: string[];
    includeRelatedEdges?: boolean;
  }): Promise<PortableContextBundle> {
    return this.post('/api/bundles/create', options);
  }

  async validateBundle(bundle: PortableContextBundle): Promise<{ valid: boolean; errors: string[] }> {
    return this.post('/api/bundles/validate', { bundle });
  }

  async installBundle(bundle: PortableContextBundle): Promise<{
    installedNodes: number;
    updatedNodes: number;
    installedEdges: number;
    skippedEdges: number;
  }> {
    return this.post('/api/bundles/install', { bundle });
  }

  async publishBundle(
    bundle: PortableContextBundle,
    options: PublishBundleOptions = {},
  ): Promise<PublishBundleResult> {
    return this.post('/api/bundles/publish', {
      bundle,
      registry: options.registry,
      visibility: options.visibility,
    });
  }

  async generateInternalizationSuggestions(options?: {
    project?: string;
    limit?: number;
  }): Promise<InternalizationSuggestions> {
    return this.post('/api/context/internalize', options ?? {});
  }

  // ============================================================
  // Knowledge Evolution (知识进化)
  // ============================================================

  async runEvolution(options?: {
    autoApply?: boolean;
    maxItems?: number;
    mode?: 'standard' | 'background';
  }): Promise<EvolutionRunResult> {
    return this.post('/api/evolve', options ?? {});
  }

  async runMetabolism(options?: {
    project?: string;
    trigger?: 'manual' | 'scheduled' | 'event_driven';
  }): Promise<MetabolismRun> {
    return this.post('/api/metabolism/run', options ?? {});
  }

  // ============================================================
  // HTTP helpers
  // ============================================================

  private async fetch<T = unknown>(path: string): Promise<T> {
    return this.doFetch(path, { method: 'GET' }).then(r => r.json() as Promise<T>);
  }

  private async post<T = unknown>(path: string, body: unknown): Promise<T> {
    const res = await this.doFetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    return res.json() as Promise<T>;
  }

  private async doFetch(path: string, init: RequestInit): Promise<Response> {
    const url = `${this.baseUrl}${path}`;
    const headers: Record<string, string> = {
      ...(init.headers as Record<string, string> ?? {}),
    };

    if (this.apiKey) {
      headers['Authorization'] = `Bearer ${this.apiKey}`;
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeout);

    try {
      const res = await globalThis.fetch(url, {
        ...init,
        headers,
        signal: controller.signal,
      });

      if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new Error(`Team Server error ${res.status}: ${body}`);
      }

      return res;
    } finally {
      clearTimeout(timer);
    }
  }
}
