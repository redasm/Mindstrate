/**
 * Project graph selector for context assembly.
 *
 * Bridges the gap between the project relationship network (file /
 * function / component / dependency / asset / module nodes plus
 * IMPORTS / CALLS / BINDS_TO / DEPENDS_ON / REFERENCES_ASSET edges)
 * and `MindstrateContextAssemblyApi.assembleContext`.
 *
 * Why a dedicated selector rather than reusing `ContextPrioritySelector`:
 * the priority selector picks across `RULE / PATTERN / SUMMARY` substrate
 * by quality + embedding similarity. Project graph nodes are
 * `SNAPSHOT + ARCHITECTURE` carrying `metadata.projectGraph === true`, so
 * the priority selector silently dropped them and the assembled context
 * never showed any actual relationships from the architecture book —
 * see `D:\\MindstrateOb\\<project>\\architecture\\` (00-overview.md ...
 * 07-risky-files.md plus the file/component nodes underneath).
 *
 * Selection strategy (kept narrow on purpose; LLM free):
 *   1. Seed by `RetrievalContext.currentFile`. Try `pg:<project>:file:<path>`
 *      directly first; fall back to suffix match against any project
 *      graph node whose evidence path ends with the same path tail.
 *   2. Seed by `taskDescription` token match against title / id /
 *      sourceRef / evidence paths (token = `[a-z0-9./_-]{2,}` lower-cased).
 *      Token matching beats the previous full-string `includes` match
 *      because natural-language task descriptions never contain a node
 *      title verbatim.
 *   3. Walk one hop in / out from the seed set, keeping the union.
 *   4. Sort by salience and cap at `limit` (default 8).
 *
 * The output is shaped as `ProjectGraphContextFact` so the assembled
 * context section is human-readable Markdown without further parsing
 * downstream.
 */

import {
  PROJECT_GRAPH_METADATA_KEYS,
  isProjectGraphEdge,
  isProjectGraphNode,
  type ContextEdge,
  type ContextNode,
  type RetrievalContext,
  type ProjectGraphContextFact,
} from '@mindstrate/protocol/models';
import { sortProjectGraphNodesBySalience } from '../project-graph/salience.js';

export interface ProjectGraphAssemblySelection {
  /** Project graph nodes pulled into the assembled context, salience-sorted. */
  facts: ProjectGraphContextFact[];
  /** All node ids in `facts`, useful for retrieval-id minting. */
  nodeIds: string[];
}

export interface ProjectGraphAssemblySelectorInput {
  /** Project-scoped slice of project graph nodes (already filtered to one project). */
  nodes: ContextNode[];
  /** Project-scoped slice of edges (any kind). */
  edges: ContextEdge[];
  /** Free-form task description for token matching. */
  taskDescription: string;
  /** Optional retrieval context for precise seeding (currentFile etc.). */
  context?: RetrievalContext;
  /** Maximum number of facts to surface. Defaults to 8. */
  limit?: number;
}

const DEFAULT_LIMIT = 8;
const MAX_EVIDENCE_PER_FACT = 3;

export const selectProjectGraphAssemblyFacts = (
  input: ProjectGraphAssemblySelectorInput,
): ProjectGraphAssemblySelection => {
  const projectGraphNodes = input.nodes.filter(isProjectGraphNode);
  const projectGraphEdges = input.edges.filter(isProjectGraphEdge);
  if (projectGraphNodes.length === 0) return { facts: [], nodeIds: [] };

  const seedIds = new Set<string>();
  collectCurrentFileSeeds(projectGraphNodes, input.context?.currentFile, seedIds);
  collectTokenMatchSeeds(projectGraphNodes, input.taskDescription, seedIds);
  if (seedIds.size === 0) return { facts: [], nodeIds: [] };

  const relatedIds = expandOneHop(projectGraphNodes, projectGraphEdges, seedIds);
  const selected = sortProjectGraphNodesBySalience(
    projectGraphNodes.filter((node) => relatedIds.has(node.id)),
    projectGraphEdges,
  ).slice(0, input.limit ?? DEFAULT_LIMIT);

  const facts: ProjectGraphContextFact[] = selected.map((node) => ({
    nodeId: node.id,
    label: node.title,
    kind: nodeKind(node),
    evidence: nodeEvidencePaths(node).slice(0, MAX_EVIDENCE_PER_FACT),
    source: seedIds.has(node.id) ? 'seed' : 'related',
  }));

  return { facts, nodeIds: facts.map((fact) => fact.nodeId) };
};

const collectCurrentFileSeeds = (
  nodes: ContextNode[],
  currentFile: string | undefined,
  seedIds: Set<string>,
): void => {
  if (!currentFile) return;
  const normalized = currentFile.replace(/\\/g, '/').toLowerCase();
  for (const node of nodes) {
    const idLower = node.id.toLowerCase();
    if (idLower.endsWith(`:file:${normalized}`)) seedIds.add(node.id);
  }
  if (seedIds.size > 0) return;
  for (const node of nodes) {
    const paths = nodeEvidencePaths(node);
    if (paths.some((path) => normalized.endsWith(path.toLowerCase())
      || path.toLowerCase().endsWith(normalized))) {
      seedIds.add(node.id);
    }
  }
};

const collectTokenMatchSeeds = (
  nodes: ContextNode[],
  taskDescription: string,
  seedIds: Set<string>,
): void => {
  const tokens = tokenize(taskDescription);
  if (tokens.length === 0) return;
  for (const node of nodes) {
    if (seedIds.has(node.id)) continue;
    const haystack = [
      node.title,
      node.id,
      node.sourceRef ?? '',
      ...nodeEvidencePaths(node),
    ].join('\n').toLowerCase();
    if (tokens.some((token) => haystack.includes(token))) seedIds.add(node.id);
  }
};

const expandOneHop = (
  nodes: ContextNode[],
  edges: ContextEdge[],
  seedIds: Set<string>,
): Set<string> => {
  const validIds = new Set(nodes.map((node) => node.id));
  const result = new Set(seedIds);
  for (const edge of edges) {
    if (seedIds.has(edge.sourceId) && validIds.has(edge.targetId)) result.add(edge.targetId);
    if (seedIds.has(edge.targetId) && validIds.has(edge.sourceId)) result.add(edge.sourceId);
  }
  return result;
};

const tokenize = (value: string): string[] => Array.from(new Set(value
  .toLowerCase()
  .split(/[^a-z0-9\u4e00-\u9fff./_-]+/)
  .map((token) => token.trim())
  .filter((token) => token.length >= 2)));

const nodeKind = (node: ContextNode): string =>
  String(node.metadata?.[PROJECT_GRAPH_METADATA_KEYS.kind] ?? 'unknown');

const nodeEvidencePaths = (node: ContextNode): string[] => {
  const evidence = node.metadata?.[PROJECT_GRAPH_METADATA_KEYS.evidence];
  if (!Array.isArray(evidence)) return node.sourceRef ? [node.sourceRef] : [];
  return evidence
    .map((entry) => entry && typeof entry === 'object' && 'path' in entry
      ? String((entry as Record<string, unknown>).path)
      : '')
    .filter(Boolean);
};
