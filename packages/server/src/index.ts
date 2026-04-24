/**
 * @mindstrate/server
 *
 * Mindstrate RAG 记忆体核心库
 */

// Main facade
export { Mindstrate, type KnowledgeMutationSink } from './mindstrate.js';

// Config
export { loadConfig, type MindstrateConfig } from './config.js';

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

// Math
export { cosineSimilarity, daysSince, isPast } from './math.js';

// OpenAI Client Factory
export { getOpenAIClient, clearOpenAIClientCache, type OpenAIClient } from './openai-client.js';

// Models
export * from '@mindstrate/protocol';

// Storage
export type { IVectorStore, VectorDocument, VectorSearchResult } from './storage/vector-store-interface.js';
export { MetadataStore } from './storage/metadata-store.js';
export { VectorStore } from './storage/vector-store.js';
export { SessionStore } from './storage/session-store.js';
export {
  ContextGraphStore,
  ContextNodeRepository,
  ContextEdgeRepository,
  GraphQuery,
  ContextPrioritySelector,
  GraphKnowledgeProjector,
  ContextInternalizer,
  ProjectedKnowledgeSearch,
  runContextAssemblyDag,
  buildSessionSnapshotContent,
  ConflictDetector,
  ConflictReflector,
  digestCompletedSession,
  buildEpisodeTitle,
  digestSessionObservation,
  PatternCompressor,
  RuleCompressor,
  SummaryCompressor,
  sessionObservationToDomainType,
  sessionObservationToEventType,
  type ContextAssemblyDagDeps,
  type ContextAssemblyDagInput,
  type ContextAssemblyDagResult,
  type GraphNeighborhood,
  type CreateContextEdgeInput,
  type CreateContextEventInput,
  type CreateContextNodeInput,
  type DigestCompletedSessionInput,
  type DigestSessionObservationInput,
  type ConflictDetectionOptions,
  type ConflictDetectionResult,
  type ConflictReflectionOptions,
  type ConflictReflectionResult,
  type ContextPrioritySelection,
  type ContextPrioritySelectorOptions,
  type GraphKnowledgeProjectionOptions,
  type InternalizationSuggestionOptions,
  type InternalizationSuggestions,
  type ProjectedKnowledgeSearchOptions,
  type PatternCompressionOptions,
  type PatternCompressionResult,
  type RuleCompressionOptions,
  type RuleCompressionResult,
  type SummaryCompressionOptions,
  type SummaryCompressionResult,
  type UpdateContextNodeInput,
} from './context-graph/index.js';
export {
  KnowledgeProjectionMaterializer,
  KnowledgeUnitMaterializer,
  ObsidianProjectionMaterializer,
  ProjectSnapshotProjectionMaterializer,
  SessionProjectionMaterializer,
} from './projections/index.js';
export {
  Assimilator,
  DigestEngine,
  MetabolicCompressor,
  MetabolismEngine,
  MetabolismScheduler,
  Pruner,
  Reflector,
  type MetabolismSchedulerOptions,
  type ReflectionStageResult,
  type RunMetabolismOptions,
  type PruneOptions,
  type PruneResult,
} from './metabolism/index.js';
export {
  ingestContextEvent,
  ingestGitActivity,
  ingestTestRun,
  ingestLspDiagnostic,
  ingestUserFeedback,
  ingestKnowledgeWrite,
  ingestProjectSnapshotEvent,
  type IngestContextEventInput,
  type IngestContextEventResult,
  type IngestGitActivityInput,
  type IngestTestRunInput,
  type IngestLspDiagnosticInput,
  type IngestUserFeedbackInput,
} from './events/index.js';
export {
  PortableContextBundleManager,
  type CreateBundleOptions,
  type EditableBundleFiles,
  type InstallBundleResult,
  type PublishBundleOptions,
  type PublishBundleResult,
  type ValidateBundleResult,
} from './bundles/index.js';

// Processing
export { Embedder } from './processing/embedder.js';
export { Pipeline, type PipelineResult, type QualityGateResult } from './processing/pipeline.js';
export { SessionCompressor } from './processing/session-compressor.js';

// Retrieval
export { Retriever } from './retrieval/retriever.js';

// Quality
export { QualityScorer } from './quality/scorer.js';
export { FeedbackLoop } from './quality/feedback-loop.js';
export { KnowledgeEvolution, type EvolutionSuggestion, type EvolutionRunResult } from './quality/evolution.js';
export { RetrievalEvaluator, type EvalCase, type EvalRunResult, type EvalCaseResult } from './quality/eval.js';

// Capture
export {
  KnowledgeExtractor,
  type CommitInfo,
  type ExtractionResult,
} from './capture/index.js';

// Project detection / snapshot
export {
  detectProject,
  findProjectRoot,
  buildProjectSnapshot,
  projectSnapshotId,
  extractPreserveBlocks,
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
  type ProjectSnapshotResult,
  type SnapshotOptions,
  type ProjectMeta,
} from './project/index.js';
