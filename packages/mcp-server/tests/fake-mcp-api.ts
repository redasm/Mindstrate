/**
 * Test fakes for the @mindstrate/mcp-server handler layer.
 *
 * Production handlers depend on the structural `McpApi` interface from
 * `src/types.ts`. The interface's wide method surface (knowledge, sessions,
 * context graph, metabolism, bundles, internalization) makes a straight
 * `Partial<McpApi>` cast painful, so we provide a `createFakeMcpApi`
 * helper that:
 *
 *   1. Records every call so tests can assert which sub-domain method ran
 *      with which arguments.
 *   2. Returns explicit fixture data for the handful of methods each test
 *      actually exercises.
 *   3. Throws "not implemented" on any other method, so accidentally
 *      relying on an unstubbed call surfaces immediately rather than
 *      silently returning `undefined`.
 *
 * Project graph fixtures (`projectGraphNode`, `projectGraphEdge`) attach
 * the metadata keys expected by `isProjectGraphNode` / `isProjectGraphEdge`
 * so the handler-side filters keep them.
 */

import {
  ContextRelationType,
  ContextNodeStatus,
  PROJECT_GRAPH_METADATA_KEYS,
  ProjectGraphEdgeKind,
  ProjectGraphNodeKind,
  ProjectGraphProvenance,
  SubstrateType,
  ContextDomainType,
  type ContextEdge,
  type ContextNode,
  type ProjectGraphOverlay,
} from '@mindstrate/protocol';
import type { McpApi } from '../src/types.js';

export interface FakeMcpApiCall {
  method: string;
  args: unknown[];
}

export interface FakeMcpApi extends McpApi {
  readonly calls: FakeMcpApiCall[];
}

export interface FakeMcpApiOptions {
  contextNodes?: ContextNode[];
  contextEdges?: ContextEdge[];
  /**
   * Architecture system-page RULE nodes that should be returned alongside
   * `contextNodes` from `queryContextGraph` (the same call serves both).
   * The handler-utils `loadSystemPageRules` filter uses
   * `metadata.systemPage === true` to pick these out.
   */
  systemPageRules?: ContextNode[];
  overlays?: ProjectGraphOverlay[];
  createOverlay?: (input: unknown) => ProjectGraphOverlay;
  /**
   * Override the result `importObsidianProjectionFile` returns. Lets
   * tests exercise the three handler branches (changed, unchanged
   * already-in-sync, not importable) without standing up a real store.
   */
  importObsidianProjectionFileResult?: {
    changed: boolean;
    sourceNodeId?: string;
    candidateNode?: { id?: string };
    event?: { id?: string };
  };
}

export const createFakeMcpApi = (options: FakeMcpApiOptions = {}): FakeMcpApi => {
  const calls: FakeMcpApiCall[] = [];
  const record = (method: string, ...args: unknown[]): void => {
    calls.push({ method, args });
  };
  const notImplemented = (method: string) => async () => {
    throw new Error(`FakeMcpApi.${method} was called but not stubbed in this test.`);
  };

  return {
    calls,
    async init() { record('init'); },
    close() { record('close'); },
    // ---------- KnowledgeApi ----------
    add: notImplemented('add'),
    get: notImplemented('get'),
    getStats: notImplemented('getStats'),
    async recordFeedback(retrievalId, signal, context) {
      record('recordFeedback', retrievalId, signal, context);
    },
    curateContext: notImplemented('curateContext'),
    assembleContext: notImplemented('assembleContext'),
    runEvolution: notImplemented('runEvolution'),
    readGraphKnowledge: notImplemented('readGraphKnowledge'),
    queryGraphKnowledge: notImplemented('queryGraphKnowledge'),
    // ---------- SessionApi ----------
    startSession: notImplemented('startSession'),
    saveObservation: notImplemented('saveObservation'),
    endSession: notImplemented('endSession'),
    getSession: notImplemented('getSession'),
    getActiveSession: notImplemented('getActiveSession'),
    formatSessionContext: notImplemented('formatSessionContext'),
    // ---------- ContextGraphApi ----------
    ingestContextEvent: notImplemented('ingestContextEvent'),
    async queryContextGraph(query) {
      record('queryContextGraph', query);
      return [
        ...(options.contextNodes ?? []),
        ...(options.systemPageRules ?? []),
      ];
    },
    async listContextEdges(query) {
      record('listContextEdges', query);
      return options.contextEdges ?? [];
    },
    async listContextConflicts(query) {
      record('listContextConflicts', query);
      return [];
    },
    async createProjectGraphOverlay(input) {
      record('createProjectGraphOverlay', input);
      if (options.createOverlay) return options.createOverlay(input);
      throw new Error('FakeMcpApi.createProjectGraphOverlay was called but no fixture provided.');
    },
    async listProjectGraphOverlays(query) {
      record('listProjectGraphOverlays', query);
      return options.overlays ?? [];
    },
    acceptConflictCandidate: notImplemented('acceptConflictCandidate'),
    rejectConflictCandidate: notImplemented('rejectConflictCandidate'),
    reindexProjectGraph: notImplemented('reindexProjectGraph'),
    // ---------- MetabolismApi ----------
    runMetabolism: notImplemented('runMetabolism'),
    runMetabolismStage: notImplemented('runMetabolismStage'),
    // ---------- BundleApi ----------
    createBundle: notImplemented('createBundle'),
    validateBundle: notImplemented('validateBundle'),
    installBundle: notImplemented('installBundle'),
    installBundleFromRegistry: notImplemented('installBundleFromRegistry'),
    publishBundle: notImplemented('publishBundle'),
    // ---------- InternalizationApi ----------
    generateInternalizationSuggestions: notImplemented('generateInternalizationSuggestions'),
    acceptInternalizationSuggestions: notImplemented('acceptInternalizationSuggestions'),
    writeObsidianProjectionFiles: notImplemented('writeObsidianProjectionFiles'),
    importObsidianProjectionFile: async (filePath: string) => {
      record('importObsidianProjectionFile', filePath);
      return options.importObsidianProjectionFileResult ?? { changed: false };
    },
    // ---------- SkillEvolutionApi ----------
    listSkillPatches: notImplemented('listSkillPatches'),
    getSkillPatch: notImplemented('getSkillPatch'),
    evaluateSkillPatch: notImplemented('evaluateSkillPatch'),
    rejectSkillPatch: notImplemented('rejectSkillPatch'),
    renderBestSkillArtifact: notImplemented('renderBestSkillArtifact'),
    optimizeSkillTargets: notImplemented('optimizeSkillTargets'),
  } satisfies FakeMcpApi;
};

// ============================================================
// Project graph fixtures
// ============================================================

interface ProjectGraphNodeFixtureOptions {
  id: string;
  title: string;
  kind?: ProjectGraphNodeKind;
  project?: string;
  evidencePaths?: string[];
}

export const projectGraphNode = (input: ProjectGraphNodeFixtureOptions): ContextNode => ({
  id: input.id,
  title: input.title,
  content: `${input.title} content`,
  tags: [],
  substrateType: SubstrateType.SNAPSHOT,
  domainType: ContextDomainType.ARCHITECTURE,
  project: input.project ?? 'demo',
  status: ContextNodeStatus.ACTIVE,
  qualityScore: 80,
  confidence: 0.9,
  compressionLevel: 1,
  accessCount: 0,
  positiveFeedback: 0,
  negativeFeedback: 0,
  createdAt: '2024-01-01T00:00:00.000Z',
  updatedAt: '2024-01-01T00:00:00.000Z',
  metadata: {
    [PROJECT_GRAPH_METADATA_KEYS.projectGraph]: true,
    [PROJECT_GRAPH_METADATA_KEYS.kind]: input.kind ?? ProjectGraphNodeKind.FILE,
    [PROJECT_GRAPH_METADATA_KEYS.provenance]: ProjectGraphProvenance.EXTRACTED,
    [PROJECT_GRAPH_METADATA_KEYS.evidence]: (input.evidencePaths ?? []).map((path) => ({ path })),
  },
});

interface ProjectGraphEdgeFixtureOptions {
  id?: string;
  sourceId: string;
  targetId: string;
  kind?: ProjectGraphEdgeKind;
}

export const projectGraphEdge = (input: ProjectGraphEdgeFixtureOptions): ContextEdge => ({
  id: input.id ?? `${input.sourceId}->${input.targetId}`,
  sourceId: input.sourceId,
  targetId: input.targetId,
  relationType: ContextRelationType.RELATED_TO,
  createdAt: '2024-01-01T00:00:00.000Z',
  updatedAt: '2024-01-01T00:00:00.000Z',
  evidence: {
    [PROJECT_GRAPH_METADATA_KEYS.projectGraph]: true,
    [PROJECT_GRAPH_METADATA_KEYS.kind]: input.kind ?? ProjectGraphEdgeKind.RELATED_TO,
  },
});

interface SystemPageRuleFixtureOptions {
  pageKey: string;
  title?: string;
  content?: string;
  project?: string;
  classifications?: string[];
  knownConstraints?: string[];
  doNotEditTargets?: string[];
  affectedChain?: string;
  recommendedVerification?: string[];
  sourceOfTruth?: string[];
  triggers?: {
    extensions?: string[];
    pathContains?: string[];
    pathSuffix?: string[];
  };
}

/**
 * Build a fake architecture system-page RULE node — the kind produced by
 * `internalize-system-pages.ts` in the server package. Tests use these
 * to verify that `before-edit` reports surface project-specific
 * constraints / chains / verification text rather than the generic
 * fallbacks.
 */
export const systemPageRule = (input: SystemPageRuleFixtureOptions): ContextNode => ({
  id: `architecture:system-page:${input.project ?? 'demo'}:${input.pageKey}`,
  title: input.title ?? `System page ${input.pageKey}`,
  content: input.content ?? `Body for ${input.pageKey}`,
  tags: ['architecture', 'system-page', `system-page:${input.pageKey}`, ...(input.classifications ?? [])],
  substrateType: 'rule' as never,
  domainType: ContextDomainType.ARCHITECTURE,
  project: input.project ?? 'demo',
  status: 'verified' as never,
  qualityScore: 95,
  confidence: 0.95,
  compressionLevel: 0.1,
  accessCount: 0,
  positiveFeedback: 0,
  negativeFeedback: 0,
  createdAt: '2024-01-01T00:00:00.000Z',
  updatedAt: '2024-01-01T00:00:00.000Z',
  sourceRef: `system-page:${input.pageKey}`,
  metadata: {
    systemPage: true,
    pageKey: input.pageKey,
    classifications: input.classifications,
    knownConstraints: input.knownConstraints,
    doNotEditTargets: input.doNotEditTargets,
    affectedChain: input.affectedChain,
    recommendedVerification: input.recommendedVerification,
    sourceOfTruth: input.sourceOfTruth,
    triggers: input.triggers,
  },
});
