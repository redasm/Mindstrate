import {
  MAX_PROJECT_GRAPH_CHANGESET_FILES,
  PROJECT_GRAPH_DEFAULT_QUERY_LIMIT,
  PROJECT_GRAPH_METADATA_KEYS,
  ProjectGraphNodeKind,
  isProjectGraphNode,
  type ChangeSource,
  type ContextNode,
  type ProjectGraphExternalChangeMarker,
} from '@mindstrate/protocol/models';
import { projectGraphNodeMatchesFile, readExternalChangeMarker } from './changes.js';

export interface RecordProjectGraphExternalChangesInput {
  project: string;
  source: ChangeSource;
  /** Repo-relative paths touched by one upstream change event (commit / changelist). */
  files: string[];
  /** Upstream identifier, e.g. a git hash or `p4@<changelist>`. */
  externalRef?: string;
  occurredAt?: string;
}

export interface ProjectGraphExternalChangeRecordResult {
  /** Project-graph nodes that own a changed file and got a staleness marker bump. */
  markedNodeIds: string[];
  /** Changed files no indexed node owns (new files, or paths outside scan roots). */
  unmatchedFiles: number;
}

export interface ExternalChangeGraphStore {
  listNodes(options?: { project?: string; limit?: number }): ContextNode[];
  updateNode(id: string, input: { metadata?: Record<string, unknown> }): ContextNode | null;
}

/**
 * Record one upstream change event (a commit or P4 changelist seen by an
 * external scanner) against the indexed project graph. The graph itself is
 * only rebuilt from a local checkout, so between reindex runs its file-level
 * facts drift from upstream; these markers turn that silent drift into an
 * explicit staleness signal that change detection surfaces as risk hints.
 *
 * Each affected node's marker counts change events (not files), and the
 * project node always gets a bump so overall staleness is visible even when
 * every changed file is new to the graph. Markers are cleared by reindexing
 * because the graph writer rebuilds node metadata from extraction.
 */
export const recordProjectGraphExternalChanges = (
  store: ExternalChangeGraphStore,
  input: RecordProjectGraphExternalChangesInput,
): ProjectGraphExternalChangeRecordResult => {
  const files = input.files
    .slice(0, MAX_PROJECT_GRAPH_CHANGESET_FILES)
    .map(normalizePath)
    .filter((file) => file.length > 0);
  if (files.length === 0) return { markedNodeIds: [], unmatchedFiles: 0 };

  const nodes = store
    .listNodes({ project: input.project, limit: PROJECT_GRAPH_DEFAULT_QUERY_LIMIT })
    .filter(isProjectGraphNode);
  if (nodes.length === 0) return { markedNodeIds: [], unmatchedFiles: files.length };

  const occurredAt = input.occurredAt ?? new Date().toISOString();
  const markedNodeIds: string[] = [];
  const matchedFiles = new Set<string>();

  for (const node of nodes) {
    if (isProjectNode(node)) continue;
    const owned = files.filter((file) => projectGraphNodeMatchesFile(node, file));
    if (owned.length === 0) continue;
    for (const file of owned) matchedFiles.add(file);
    bumpMarker(store, node, input, occurredAt);
    markedNodeIds.push(node.id);
  }

  const projectNode = nodes.find(isProjectNode);
  if (projectNode) {
    bumpMarker(store, projectNode, input, occurredAt);
  }

  return {
    markedNodeIds,
    unmatchedFiles: files.length - matchedFiles.size,
  };
};

const bumpMarker = (
  store: ExternalChangeGraphStore,
  node: ContextNode,
  input: RecordProjectGraphExternalChangesInput,
  occurredAt: string,
): void => {
  const existing = readExternalChangeMarker(node);
  const marker: ProjectGraphExternalChangeMarker = {
    pendingChanges: (existing?.pendingChanges ?? 0) + 1,
    lastSource: input.source,
    lastExternalRef: input.externalRef ?? existing?.lastExternalRef,
    lastChangedAt: occurredAt,
  };
  store.updateNode(node.id, {
    metadata: {
      ...(node.metadata ?? {}),
      [PROJECT_GRAPH_METADATA_KEYS.externalChanges]: marker,
    },
  });
};

const isProjectNode = (node: ContextNode): boolean =>
  node.metadata?.[PROJECT_GRAPH_METADATA_KEYS.kind] === ProjectGraphNodeKind.PROJECT;

const normalizePath = (value: string): string => value.replace(/\\/g, '/').trim();
