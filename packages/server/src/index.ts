/**
 * @mindstrate/server
 *
 * Mindstrate RAG 记忆体核心库
 *
 * Public API surface intentionally narrow:
 *   - `Mindstrate` facade exposes 11 sub-domain APIs (memory.knowledge,
 *     memory.context, memory.evaluation, ...). Application packages should
 *     drive all behavior through these sub-domains, not raw functions.
 *   - Types/constants/errors are re-exported for callers (CLI, web-ui,
 *     team-server, mcp-server) so they can describe inputs and outputs
 *     without depending on internal modules.
 *   - Raw project-graph / project-snapshot / context-graph / metabolism
 *     functions are NOT exported. They are implementation details of the
 *     sub-domain APIs and used to leak through here, encouraging callers
 *     to bypass the facade.
 */

// Main facade
export { Mindstrate } from './mindstrate.js';

// Config
export { loadConfig, type MindstrateConfig } from './config.js';

// Logger contract — applications inject a console-backed logger; mcp-server
// keeps the noop default to avoid corrupting its JSON-RPC stdio channel.
export { noopLogger, consoleLogger, type Logger } from './runtime/logger.js';

// Errors
export {
  MindstrateError,
  ValidationError,
  StorageError,
  EmbeddingError,
  LLMError,
  DuplicateError,
  NotFoundError,
  TeamServerError,
  ConfigError,
} from '@mindstrate/protocol';

// Prompts
export { PROMPT_VERSION } from './prompts.js';

// OpenAI Client Factory
export { getOpenAIClient, clearOpenAIClientCache, type OpenAIClient } from './openai-client.js';

// Models / protocol passthrough (errorMessage, truncateText, KnowledgeType,
// ContextDomainType, etc. arrive via this re-export).
export * from '@mindstrate/protocol';

// Storage primitives needed by team-server, repo-scanner, web-ui to wire
// alternative vector backends or open shared SQLite databases.
export type { IVectorStore, VectorDocument, VectorSearchResult } from './storage/vector-store-interface.js';
export { openSqliteDatabase } from './storage/sqlite-database.js';
export { readJsonFile, readJsonFileOrThrow } from './storage/json-file.js';

// Capture utility used by repo-scanner to turn raw commits into knowledge
// candidates before they are funneled back through `memory.knowledge.add`.
export {
  KnowledgeExtractor,
  type CommitInfo,
  type ExtractionResult,
} from './capture/index.js';

// Event ingestion input types — applications (repo-scanner, cli) describe
// the events they capture in these shapes before passing them to
// `memory.events.*`.
export type {
  IngestContextEventInput,
  IngestContextEventResult,
  IngestGitActivityInput,
  IngestTestRunInput,
  IngestLspDiagnosticInput,
  IngestTerminalOutputInput,
  IngestUserFeedbackInput,
} from './events/index.js';

// Context graph store + projection types — needed because some sub-domain
// API method signatures reference them and TypeScript callers must name them.
export {
  toGraphKnowledgeView,
  type CreateContextNodeInput,
  type CreateContextEdgeInput,
  type CreateContextEventInput,
  type UpdateContextNodeInput,
  type GraphKnowledgeProjectionOptions,
  type ContextPrioritySelection,
  type ContextPrioritySelectorOptions,
  type ProjectedKnowledgeSearchOptions,
} from './context-graph/index.js';

// Retrieval evaluation types — applications (team-server, cli, web-ui)
// author validation/holdout eval datasets and read run results.
export type { EvalCase, EvalCaseKind, EvalRunResult } from './quality/eval.js';

// Project detection / snapshot — applications need these to detect a
// project before they can ask sub-domain APIs to act on it.
export {
  detectProject,
  findProjectRoot,
  loadProjectMeta,
  saveProjectMeta,
  dependencyFingerprint,
  metaPath,
  PRESERVE_OPEN,
  PRESERVE_CLOSE,
  PROJECT_META_DIRNAME,
  PROJECT_META_FILENAME,
  PROJECT_META_VERSION,
  type DetectedProject,
  type DetectedDependency,
  type ProjectChangeFlow,
  type ProjectChangePlaybook,
  type ProjectModuleResponsibility,
  type ProjectOperationManual,
  type ProjectValidationCommand,
  type SuggestedSystemPage,
  type ProjectMeta,
} from './project/index.js';

// Project snapshot internals exposed for tests and tightly-coupled tooling
// that needs the deterministic snapshot id or pre-rendered body before the
// sub-domain API persists it. Application code should still prefer
// `memory.snapshots.upsertProjectSnapshot` for normal flows.
export {
  buildProjectSnapshot,
  projectSnapshotId,
  extractPreserveBlocks,
  type ProjectSnapshotResult,
  type SnapshotOptions,
} from './project/index.js';

// Project graph types — applications must be able to describe inputs to
// `memory.context.*` / `memory.evaluation.*` and read back result shapes.
// Implementations stay internal and reachable only through the facade.
export {
  // Atomic write primitive used by tests and tooling that materialise
  // project graph artifacts outside the sub-domain API (rare).
  writeProjectGraphTextFileAtomically,
  KNOWN_SYSTEM_PAGE_CLASSIFICATIONS,
} from './project-graph/index.js';
export type {
  CreateProjectGraphEdgeIdInput,
  CreateProjectGraphNodeIdInput,
  ParserAdapter,
  ParserCapture,
  ParserInput,
  ParserResult,
  QueryPack,
  ProjectFileInventoryEntry,
  ProjectGraphCacheDiff,
  ProjectGraphScanPlan,
  ProjectGraphScanScope,
  ProjectGraphScanProgress,
  ProjectGraphScanScopeOptions,
  ScanProjectFilesOptions,
  SourceLanguage,
  ProjectGraphArtifactResult,
  ProjectGraphChangeDetectionInput,
  ProjectGraphChangeDetectionResult,
  ProjectGraphChangeStore,
  ProjectGraphEnrichmentInput,
  ProjectGraphEnrichmentResult,
  ProjectGraphBlastRadiusInput,
  ProjectGraphBlastRadiusResult,
  ProjectGraphExtractionResult,
  ProjectGraphIndexResult,
  ProjectGraphIndexOptions,
  ProjectGraphIndexProgress,
  ProjectGraphScanDiagnostics,
  ProjectGraphPathInput,
  ProjectGraphPathResult,
  ProjectGraphTaskQuery,
  ProjectGraphTaskQueryInput,
  ProjectGraphTaskQueryItem,
  ProjectGraphTaskQueryResult,
  ProjectGraphTaskGuidance,
  CreateProjectGraphOverlayInput,
  ListProjectGraphOverlayInput,
  ProjectGraphStatsExport,
  ProjectGraphWriteResult,
  ProjectGraphViews,
  ProjectGraphModule,
  ProjectGraphEvaluationFixture,
  ProjectGraphEvaluationFixtureId,
  ProjectGraphEvaluationMode,
  ProjectGraphEvaluationModeMetrics,
  ProjectGraphEvaluationRun,
  ProjectGraphEvaluationRunSummary,
  ProjectGraphEvaluationTask,
  RenderProjectGraphEvaluationDatasetInput,
  ProjectGraphFixtureEvaluationInput,
  ProjectGraphFixtureEvaluationResult,
  ProjectGraphFixtureExpectations,
  ProjectGraphFixtureMetrics,
  GeneratedEditSafetyInput,
  GeneratedEditSafetyIssue,
  UnrealModuleBoundaryConsistencyInput,
  UnrealModuleBoundaryConsistencyIssue,
  UnrealPluginDependencyConsistencyInput,
  UnrealPluginDependencyConsistencyIssue,
  ProjectGraphObsidianProjectionOptions,
  SystemPageDefinition,
} from './project-graph/index.js';
