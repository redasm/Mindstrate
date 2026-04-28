/**
 * Mindstrate runtime facade.
 *
 * This class only owns process lifecycle and domain API composition. Behavior
 * belongs to the domain APIs exposed as readonly properties.
 */

import type { GraphKnowledgeSearchResult } from '@mindstrate/protocol';
import type { MindstrateConfig } from './config.js';
import type { IVectorStore } from './storage/vector-store-interface.js';
import { createMindstrateRuntime, type MindstrateRuntime } from './runtime/mindstrate-runtime.js';
import { MindstrateBundleApi } from './runtime/mindstrate-bundle-api.js';
import { MindstrateContextAssemblyApi } from './runtime/mindstrate-context-assembly-api.js';
import { MindstrateContextGraphApi } from './runtime/mindstrate-context-graph-api.js';
import { MindstrateEvaluationApi } from './runtime/mindstrate-evaluation-api.js';
import { MindstrateEventApi } from './runtime/mindstrate-event-api.js';
import { MindstrateKnowledgeApi } from './runtime/mindstrate-knowledge-api.js';
import { MindstrateMaintenanceApi } from './runtime/mindstrate-maintenance-api.js';
import { MindstrateMetabolismApi } from './runtime/mindstrate-metabolism-api.js';
import { MindstrateProjectionApi } from './runtime/mindstrate-projection-api.js';
import { MindstrateSessionApi } from './runtime/mindstrate-session-api.js';
import { MindstrateSnapshotApi } from './runtime/mindstrate-snapshot-api.js';

export class Mindstrate {
  private readonly services: MindstrateRuntime;
  readonly assembly: MindstrateContextAssemblyApi;
  readonly bundles: MindstrateBundleApi;
  readonly context: MindstrateContextGraphApi;
  readonly evaluation: MindstrateEvaluationApi;
  readonly events: MindstrateEventApi;
  readonly knowledge: MindstrateKnowledgeApi;
  readonly maintenance: MindstrateMaintenanceApi;
  readonly metabolism: MindstrateMetabolismApi;
  readonly projections: MindstrateProjectionApi;
  readonly sessions: MindstrateSessionApi;
  readonly snapshots: MindstrateSnapshotApi;
  private initialized = false;
  private initPromise: Promise<void> | null = null;

  constructor(configOverrides?: Partial<MindstrateConfig> & {
    vectorStore?: IVectorStore;
  }) {
    this.services = createMindstrateRuntime(configOverrides, (query, options) =>
      this.queryGraphKnowledgeIds(query, options.topK),
    );
    this.bundles = new MindstrateBundleApi(this.services);
    this.context = new MindstrateContextGraphApi(this.services);
    this.knowledge = new MindstrateKnowledgeApi(this.services, () => this.ensureInit());
    this.sessions = new MindstrateSessionApi(this.services);
    this.assembly = new MindstrateContextAssemblyApi(
      this.services,
      () => this.ensureInit(),
      (project) => this.sessions.formatSessionContext(project),
      (query, options) => this.context.queryGraphKnowledge(query, options),
      (project, limit) => this.context.listConflictRecords(project, limit),
    );
    this.evaluation = new MindstrateEvaluationApi(this.services, () => this.ensureInit());
    this.events = new MindstrateEventApi(this.services);
    this.maintenance = new MindstrateMaintenanceApi(this.services);
    this.metabolism = new MindstrateMetabolismApi(this.services, () => this.ensureInit());
    this.projections = new MindstrateProjectionApi(this.services);
    this.snapshots = new MindstrateSnapshotApi(this.services, () => this.ensureInit());
  }

  async init(): Promise<void> {
    if (this.initialized) return;
    if (!this.initPromise) {
      this.initPromise = this.services.vectorStore.initialize()
        .then(() => {
          this.initialized = true;
        })
        .catch((err) => {
          this.initPromise = null;
          throw err;
        });
    }
    return this.initPromise;
  }

  close(): void {
    this.metabolism.stopMetabolismScheduler();
    this.services.vectorStore.flush();
    this.services.databaseStore.close();
  }

  getConfig(): Readonly<MindstrateConfig> {
    return this.services.config;
  }

  private queryGraphKnowledgeIds(query: string, topK: number): string[] {
    return this.context.queryGraphKnowledge(query, { topK, trackFeedback: false })
      .map((result: GraphKnowledgeSearchResult) => result.view.id);
  }

  private async ensureInit(): Promise<void> {
    if (!this.initialized) {
      await this.init();
    }
  }
}
