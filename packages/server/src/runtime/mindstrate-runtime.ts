import * as fs from 'node:fs';
import { loadConfig, type MindstrateConfig } from '../config.js';
import { noopLogger, type Logger } from './logger.js';
import { DatabaseStore } from '../storage/database-store.js';
import type { IVectorStore } from '../storage/vector-store-interface.js';
import { SessionStore } from '../storage/session-store.js';
import { ApiKeyRepository } from '../storage/api-key-repository.js';
import { ScanSourceRepository } from '../storage/scan-source-repository.js';
import { LlmConfigRepository } from '../storage/llm-config-repository.js';
import { ProviderFactory } from '../processing/provider-factory.js';
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
  BestSkillProjectionMaterializer,
  ObsidianProjectionMaterializer,
  ProjectSnapshotProjectionMaterializer,
  SessionProjectionMaterializer,
} from '../projections/index.js';
import { PortableContextBundleManager } from '../bundles/index.js';
import { SkillEvolutionGate, SkillEvolutionStore } from '../skill-evolution/index.js';
import { VectorStoreFactory } from './vector-store-factory.js';

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
  bestSkillProjectionMaterializer: BestSkillProjectionMaterializer;
  metabolismEngine: MetabolismEngine;
  pruner: Pruner;
  conflictDetector: ConflictDetector;
  conflictReflector: ConflictReflector;
  patternCompressor: PatternCompressor;
  ruleCompressor: RuleCompressor;
  summaryCompressor: SummaryCompressor;
  highOrderCompressor: HighOrderCompressor;
  feedbackCooccurrenceCompressor: FeedbackCooccurrenceCompressor;
  vectorStoreFactory: VectorStoreFactory;
  sessionStore: SessionStore;
  apiKeyRepository: ApiKeyRepository;
  scanSourceRepository: ScanSourceRepository;
  llmConfigRepository: LlmConfigRepository;
  providerFactory: ProviderFactory;
  qualityGate: KnowledgeQualityGate;
  sessionCompressor: SessionCompressor;
  bundleManager: PortableContextBundleManager;
  feedbackLoop: FeedbackLoop;
  evaluator: RetrievalEvaluator;
  skillEvolutionStore: SkillEvolutionStore;
  skillEvolutionGate: SkillEvolutionGate;
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
  const bestSkillProjectionMaterializer = new BestSkillProjectionMaterializer(contextGraphStore);
  const llmConfigRepository = new LlmConfigRepository(databaseStore.getDb());
  const providerFactory = new ProviderFactory(llmConfigRepository);
  const conflictDetector = new ConflictDetector(contextGraphStore, providerFactory);
  const conflictReflector = new ConflictReflector(contextGraphStore);
  const patternCompressor = new PatternCompressor(contextGraphStore, providerFactory);
  const ruleCompressor = new RuleCompressor(contextGraphStore, providerFactory);
  const summaryCompressor = new SummaryCompressor(contextGraphStore, providerFactory);
  const highOrderCompressor = new HighOrderCompressor(contextGraphStore, providerFactory);
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
  const vectorStoreFactory = new VectorStoreFactory(config, providerFactory);
  const sessionStore = new SessionStore(databaseStore.getDb());
  const apiKeyRepository = new ApiKeyRepository(databaseStore.getDb());
  const scanSourceRepository = new ScanSourceRepository(databaseStore.getDb());
  const bundleManager = new PortableContextBundleManager(contextGraphStore);
  const sessionCompressor = new SessionCompressor(providerFactory, logger);
  const feedbackLoop = new FeedbackLoop(databaseStore.getDb());
  const feedbackCooccurrenceCompressor = new FeedbackCooccurrenceCompressor(
    contextGraphStore,
    databaseStore.getDb(),
  );
  const qualityGate = new KnowledgeQualityGate();
  const evaluator = new RetrievalEvaluator(databaseStore.getDb(), queryGraphKnowledgeIds);
  const skillEvolutionStore = new SkillEvolutionStore(databaseStore.getDb());
  const skillEvolutionGate = new SkillEvolutionGate(skillEvolutionStore, contextGraphStore);

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
    bestSkillProjectionMaterializer,
    metabolismEngine,
    pruner,
    conflictDetector,
    conflictReflector,
    patternCompressor,
    ruleCompressor,
    summaryCompressor,
    highOrderCompressor,
    feedbackCooccurrenceCompressor,
    vectorStoreFactory,
    sessionStore,
    apiKeyRepository,
    scanSourceRepository,
    llmConfigRepository,
    providerFactory,
    qualityGate,
    sessionCompressor,
    bundleManager,
    feedbackLoop,
    evaluator,
    skillEvolutionStore,
    skillEvolutionGate,
  };
}
