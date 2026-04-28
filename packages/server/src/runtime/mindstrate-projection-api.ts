import type {
  AcceptInternalizationSuggestionsOptions,
  AcceptInternalizationSuggestionsResult,
  InternalizationSuggestionOptions,
  InternalizationSuggestions,
} from '../context-graph/context-internalizer.js';
import type { MindstrateRuntime } from './mindstrate-runtime.js';
import type { ProjectionRecord } from '@mindstrate/protocol/models';

export class MindstrateProjectionApi {
  constructor(private readonly services: MindstrateRuntime) {}

  projectSessionSummaries(options?: { project?: string; limit?: number }): ProjectionRecord[] {
    return this.services.sessionProjectionMaterializer.materialize(options);
  }

  projectProjectSnapshots(options?: { project?: string; limit?: number }): ProjectionRecord[] {
    return this.services.projectSnapshotProjectionMaterializer.materialize(options);
  }

  projectObsidianDocuments(options?: { project?: string; limit?: number }): ProjectionRecord[] {
    return this.services.obsidianProjectionMaterializer.materialize(options);
  }

  writeObsidianProjectionFiles(options: { project?: string; limit?: number; rootDir: string }): string[] {
    return this.services.obsidianProjectionMaterializer.writeFiles(options);
  }

  importObsidianProjectionFile(filePath: string) {
    return this.services.obsidianProjectionMaterializer.importFile(filePath);
  }

  generateInternalizationSuggestions(options?: InternalizationSuggestionOptions): InternalizationSuggestions {
    return this.services.contextInternalizer.generateSuggestions(options);
  }

  acceptInternalizationSuggestions(options?: AcceptInternalizationSuggestionsOptions): AcceptInternalizationSuggestionsResult {
    return this.services.contextInternalizer.acceptSuggestions(options);
  }

  listProjectionRecords(options?: { nodeId?: string; target?: string; limit?: number }): ProjectionRecord[] {
    return this.services.contextGraphStore.listProjectionRecords(options);
  }
}

