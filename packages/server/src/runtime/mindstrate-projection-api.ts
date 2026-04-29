import type {
  AcceptInternalizationSuggestionsOptions,
  AcceptInternalizationSuggestionsResult,
  InternalizationSuggestionOptions,
  InternalizationSuggestions,
} from '../context-graph/context-internalizer.js';
import type { MindstrateRuntime } from './mindstrate-runtime.js';
import { ProjectionTarget, type ProjectionRecord } from '@mindstrate/protocol/models';

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

  recordProjectGraphTeamProjection(input: { nodeId: string; repoId: string }): ProjectionRecord {
    return this.services.contextGraphStore.upsertProjectionRecord({
      id: `projection:${ProjectionTarget.PROJECT_GRAPH_TEAM_SERVER}:${input.repoId}`,
      nodeId: input.nodeId,
      target: ProjectionTarget.PROJECT_GRAPH_TEAM_SERVER,
      targetRef: input.repoId,
      version: 1,
    });
  }
}
