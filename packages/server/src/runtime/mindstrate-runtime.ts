import * as fs from 'node:fs';
import { loadConfig, type MindstrateConfig } from '../config.js';
import { noopLogger, type Logger } from './logger.js';
import { DatabaseStore } from '../storage/database-store.js';
import { VectorStore } from '../storage/vector-store.js';
import { QdrantVectorStore } from '../storage/qdrant-vector-store.js';
import type { IVectorStore } from '../storage/vector-store-interface.js';
import { SessionStore } from '../storage/session-store.js';
import { ApiKeyRepository } from '../storage/api-key-repository.js';
import { ScanSourceRepository } from '../storage/scan-source-repository.js';
import { Embedder } from '../processing/embedder.js';
import { KnowledgeQualityGate } from '../processing/knowledge-quality-gate.js';
import { SessionCompressor } from '../processing/session-compressor.js';
import { FeedbackLoop } from '../quality/feedback-loop.js';
import { RetrievalEvaluator } from '../quality/eval.js';
import { ContextInternalizer } from '../context-graph/context-internalizer.js';
import { ContextPrioritySelector } from '../context-graph/context-priority-selector.js';
import { ContextGraphStore } from '../context-graph/context-graph-store.js';
import { GraphKnowledgeProjector } from '../context-graph/knowledge-projector.js';
import { ProjectedKnowledgeSearch } from '../context-graph/projected-knowledge-search.js';
import { ConflictDetector } from '../context-graph/conflict-detector.js';
import { ConflictReflector } from '../context-graph/conflict-reflector.js';
import { PatternCompressor } from '../context-graph/pattern-compressor.js';
import { RuleCompressor } from '../context-graph/rule-compressor.js';
import { SummaryCompressor } from '../context-graph/summary-compressor.js';
import { HighOrderCompressor } from '../context-graph/high-order-compressor.js';
import { FeedbackCooccurrenceCompressor } from '../context-graph/feedback-cooccurrence-compressor.js';
import { MetabolismEngine, Pruner } from '../metabolism/index.js';
import {
  KnowledgeProjectionMaterializer,
  ObsidianProjectionMaterializer,
  ProjectSnapshotProjectionMaterializer,
  SessionProjectionMaterializer,
} from '../projections/index.js';
import { PortableContextBundleManager } from '../bundles/index.js';

export interface MindstrateRuntime {
  config: MindstrateConfig;
  logger: Logger;
  databaseStore: DatabaseStore;
  contextGraphStore: ContextGraphStore;
  contextInternalizer: ContextInternalizer;
  contextPrioritySelector: ContextPrioritySelector;
  graphKnowledgeProjector: GraphKnowledgeProjector;
  projectedKnowledgeSearch: ProjectedKnowledgeSearch;
  projectionMaterializer: KnowledgeProjectionMaterializer;
  sessionProjectionMaterializer: SessionProjectionMaterializer;
  projectSnapshotProjectionMaterializer: ProjectSnapshotProjectionMaterializer;
  obsidianProjectionMaterializer: ObsidianProjectionMaterializer;
  metabolismEngine: MetabolismEngine;
  pruner: Pruner;
  conflictDetector: ConflictDetector;
  conflictReflector: ConflictReflector;
  patternCompressor: PatternCompressor;
  ruleCompressor: RuleCompressor;
  summaryCompressor: SummaryCompressor;
  highOrderCompressor: HighOrderCompressor;
  feedbackCooccurrenceCompressor: FeedbackCooccurrenceCompressor;
  vectorStore: IVectorStore;
  sessionStore: SessionStore;
  apiKeyRepository: ApiKeyRepository;
  scanSourceRepository: ScanSourceRepository;
  embedder: Embedder;
  qualityGate: KnowledgeQualityGate;
  sessionCompressor: SessionCompressor;
  bundleManager: PortableContextBundleManager;
  feedbackLoop: FeedbackLoop;
  evaluator: RetrievalEvaluator;
}

export interface MindstrateRuntimeOptions extends Partial<MindstrateConfig> {
  vectorStore?: IVectorStore;
}

export function createMindstrateRuntime(
  configOverrides: MindstrateRuntimeOptions | undefined,
  queryGraphKnowledgeIds: (query: string, options: { topK: number }) => string[],
): MindstrateRuntime {
  const config = loadConfig(configOverrides);
  const logger = config.logger ?? noopLogger;

  if (!fs.existsSync(config.dataDir)) {
    fs.mkdirSync(config.dataDir, { recursive: true });
  }

  const llmBaseUrl = config.openaiBaseUrl;
  const embeddingBaseUrl = config.openaiEmbeddingBaseUrl ?? llmBaseUrl;
  const databaseStore = new DatabaseStore(config.dbPath);
  const contextGraphStore = new ContextGraphStore(databaseStore.getDb());
  const contextInternalizer = new ContextInternalizer(contextGraphStore);
  const contextPrioritySelector = new ContextPrioritySelector(contextGraphStore);
  const graphKnowledgeProjector = new GraphKnowledgeProjector(contextGraphStore);
  const projectedKnowledgeSearch = new ProjectedKnowledgeSearch(graphKnowledgeProjector, contextGraphStore);
  const projectionMaterializer = new KnowledgeProjectionMaterializer(contextGraphStore, graphKnowledgeProjector);
  const sessionProjectionMaterializer = new SessionProjectionMaterializer(contextGraphStore);
  const projectSnapshotProjectionMaterializer = new ProjectSnapshotProjectionMaterializer(contextGraphStore);
  const obsidianProjectionMaterializer = new ObsidianProjectionMaterializer(contextGraphStore);
  const embedder = new Embedder(config.openaiApiKey, config.embeddingModel, embeddingBaseUrl);
  const conflictDetector = new ConflictDetector(contextGraphStore, embedder);
  const conflictReflector = new ConflictReflector(contextGraphStore);
  const patternCompressor = new PatternCompressor(contextGraphStore, embedder);
  const ruleCompressor = new RuleCompressor(contextGraphStore, embedder);
  const summaryCompressor = new SummaryCompressor(contextGraphStore, embedder);
  const highOrderCompressor = new HighOrderCompressor(contextGraphStore, embedder);
  const pruner = new Pruner(contextGraphStore);
  const metabolismEngine = new MetabolismEngine({
    graphStore: contextGraphStore,
    summaryCompressor,
    patternCompressor,
    ruleCompressor,
    highOrderCompressor,
    conflictDetector,
    conflictReflector,
    projectionMaterializer,
    sessionProjectionMaterializer,
    projectSnapshotProjectionMaterializer,
    obsidianProjectionMaterializer,
    pruner,
  });
  const vectorStore = configOverrides?.vectorStore ?? createVectorStore(config, embedder);
  const sessionStore = new SessionStore(databaseStore.getDb());
  const apiKeyRepository = new ApiKeyRepository(databaseStore.getDb());
  const scanSourceRepository = new ScanSourceRepository(databaseStore.getDb());
  const bundleManager = new PortableContextBundleManager(contextGraphStore);
  const sessionCompressor = new SessionCompressor(config.openaiApiKey, config.llmModel, llmBaseUrl, logger);
  const feedbackLoop = new FeedbackLoop(databaseStore.getDb());
  const feedbackCooccurrenceCompressor = new FeedbackCooccurrenceCompressor(
    contextGraphStore,
    databaseStore.getDb(),
  );
  const qualityGate = new KnowledgeQualityGate();
  const evaluator = new RetrievalEvaluator(databaseStore.getDb(), queryGraphKnowledgeIds);

  return {
    config,
    logger,
    databaseStore,
    contextGraphStore,
    contextInternalizer,
    contextPrioritySelector,
    graphKnowledgeProjector,
    projectedKnowledgeSearch,
    projectionMaterializer,
    sessionProjectionMaterializer,
    projectSnapshotProjectionMaterializer,
    obsidianProjectionMaterializer,
    metabolismEngine,
    pruner,
    conflictDetector,
    conflictReflector,
    patternCompressor,
    ruleCompressor,
    summaryCompressor,
    highOrderCompressor,
    feedbackCooccurrenceCompressor,
    vectorStore,
    sessionStore,
    apiKeyRepository,
    scanSourceRepository,
    embedder,
    qualityGate,
    sessionCompressor,
    bundleManager,
    feedbackLoop,
    evaluator,
  };
}

function createVectorStore(config: MindstrateConfig, embedder: Embedder): IVectorStore {
  if (config.vectorBackend === 'qdrant') {
    return new QdrantVectorStore({
      url: config.qdrantUrl ?? '',
      apiKey: config.qdrantApiKey,
      collectionName: config.collectionName,
      dimension: embedder.getEmbeddingDimension(),
    });
  }

  return new VectorStore(config.vectorStorePath, config.collectionName);
}
