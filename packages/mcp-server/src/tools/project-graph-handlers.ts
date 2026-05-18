import {
  ContextDomainType,
  PROJECT_GRAPH_DEFAULT_QUERY_LIMIT,
  ProjectGraphOverlaySource,
  type ProjectGraphOverlayKind,
} from '@mindstrate/protocol';
import type { McpApi, McpToolResponse } from '../types.js';
import {
  evidencePaths,
  formatProjectGraphEdges,
  formatProjectGraphNodes,
  formatProjectGraphOverlays,
} from './project-graph-render.js';
import {
  collectBlastRadius,
  collectTaskQuerySeeds,
  findProjectGraphNode,
  findProjectGraphNodeInList,
  loadSystemPageRules,
  projectGraphEdges,
  projectGraphNodes,
  shortestProjectGraphPath,
} from './project-graph-handler-utils.js';
import {
  buildBeforeEditReport,
  selectTaskNodes,
} from './project-graph-task-report.js';

type ToolInput = any;

export async function handleProjectGraphQuery(
  api: McpApi,
  input: ToolInput,
): Promise<McpToolResponse> {
  const nodes = projectGraphNodes(await api.queryContextGraph({
    query: input.query,
    project: input.project,
    domainType: ContextDomainType.ARCHITECTURE,
    limit: input.limit ?? 10,
  }));

  if (nodes.length === 0) {
    return { content: [{ type: 'text', text: 'No project graph nodes matched the query.' }] };
  }
  return { content: [{ type: 'text', text: formatProjectGraphNodes(nodes) }] };
}

export async function handleProjectGraphTaskQuery(
  api: McpApi,
  input: ToolInput,
): Promise<McpToolResponse> {
  const nodes = projectGraphNodes(await api.queryContextGraph({
    project: input.project,
    domainType: ContextDomainType.ARCHITECTURE,
    limit: PROJECT_GRAPH_DEFAULT_QUERY_LIMIT,
  }));
  const edges = projectGraphEdges(await api.listContextEdges({ limit: PROJECT_GRAPH_DEFAULT_QUERY_LIMIT }));
  // Path-aware seed selection. When the caller passed a file path (as
  // AGENTS.md tells them to for the `before-edit` workflow), match
  // against node title / sourceRef / evidence paths instead of doing a
  // free-form `title.includes(query)` — the latter used to return
  // global-hot but unrelated nodes (README.md / tsconfig.base.json /
  // web-ui/i18n) for deep paths like
  // `packages/server/src/metabolism/scheduler.ts`.
  const matching = collectTaskQuerySeeds(nodes, input.query);
  const selected = selectTaskNodes(input.task, nodes, edges, matching).slice(0, input.limit ?? 10);
  const evidence = Array.from(new Set(selected.flatMap(evidencePaths))).slice(0, input.limit ?? 10);
  if (input.task === 'before-edit' || input.task === 'impact') {
    const overlays = await api.listProjectGraphOverlays({ project: input.project, limit: 100 });
    const systemPageRules = await loadSystemPageRules(api, input.project);
    const report = buildBeforeEditReport({
      task: input.task,
      query: input.query,
      nodes,
      edges,
      selected,
      evidence,
      overlays,
      systemPageRules,
      limit: input.limit ?? 10,
    });
    return { content: [{ type: 'text', text: report }] };
  }
  const compactJson = {
    task: input.task,
    query: input.query,
    nodeIds: selected.map((node) => node.id),
    evidence,
    suggestedNextQueries: selected.slice(0, 3).map((node) => `impact ${node.title}`),
  };
  const text = [
    `### ${input.task}`,
    '',
    formatProjectGraphNodes(selected),
    '',
    '### Compact JSON',
    '```json',
    JSON.stringify(compactJson, null, 2),
    '```',
  ].join('\n');
  return { content: [{ type: 'text', text }] };
}

export async function handleProjectGraphGetNode(
  api: McpApi,
  input: ToolInput,
): Promise<McpToolResponse> {
  const node = await findProjectGraphNode(api, input.id, input.project);
  if (!node) return { content: [{ type: 'text', text: 'Project graph node not found.' }], isError: true };
  return { content: [{ type: 'text', text: formatProjectGraphNodes([node]) }] };
}

export async function handleProjectGraphGetNeighbors(
  api: McpApi,
  input: ToolInput,
): Promise<McpToolResponse> {
  const node = await findProjectGraphNode(api, input.id, input.project);
  if (!node) return { content: [{ type: 'text', text: 'Project graph node not found.' }], isError: true };
  const limit = input.limit ?? 20;
  const outgoing = projectGraphEdges(await api.listContextEdges({ sourceId: node.id, limit }));
  const incoming = projectGraphEdges(await api.listContextEdges({ targetId: node.id, limit }));
  const text = [
    formatProjectGraphNodes([node]),
    '',
    '### Outgoing Edges',
    formatProjectGraphEdges(outgoing),
    '',
    '### Incoming Edges',
    formatProjectGraphEdges(incoming),
    '',
    'Suggested next queries:',
    `- explain_project_graph_node id="${node.id}"`,
    '- query_project_graph query="entry points"',
  ].join('\n');
  return { content: [{ type: 'text', text }] };
}

export async function handleProjectGraphExplainNode(
  api: McpApi,
  input: ToolInput,
): Promise<McpToolResponse> {
  const node = await findProjectGraphNode(api, input.id, input.project);
  if (!node) return { content: [{ type: 'text', text: 'Project graph node not found.' }], isError: true };
  const outgoing = projectGraphEdges(await api.listContextEdges({ sourceId: node.id, limit: 20 }));
  const incoming = projectGraphEdges(await api.listContextEdges({ targetId: node.id, limit: 20 }));
  const overlays = await api.listProjectGraphOverlays({ project: node.project, targetNodeId: node.id, limit: 20 });
  const text = [
    `### ${node.title}`,
    `Kind: ${node.metadata?.['kind'] ?? 'unknown'}`,
    `Provenance: ${node.metadata?.['provenance'] ?? 'unknown'}`,
    `Evidence: ${evidencePaths(node).join(', ') || '(none)'}`,
    `Incoming project graph edges: ${incoming.length}`,
    `Outgoing project graph edges: ${outgoing.length}`,
    '',
    '### Overlays',
    formatProjectGraphOverlays(overlays),
    '',
    'Suggested next queries:',
    `- get_project_graph_neighbors id="${node.id}"`,
    `- query_project_graph query="${node.title}"`,
  ].join('\n');
  return { content: [{ type: 'text', text }] };
}

export async function handleProjectGraphPath(
  api: McpApi,
  input: ToolInput,
): Promise<McpToolResponse> {
  const nodes = projectGraphNodes(await api.queryContextGraph({
    project: input.project,
    domainType: ContextDomainType.ARCHITECTURE,
    limit: PROJECT_GRAPH_DEFAULT_QUERY_LIMIT,
  }));
  const edges = projectGraphEdges(await api.listContextEdges({ limit: PROJECT_GRAPH_DEFAULT_QUERY_LIMIT }));
  const path = shortestProjectGraphPath(nodes, edges, input.from, input.to, input.maxDepth ?? 6);
  if (!path) return { content: [{ type: 'text', text: 'No project graph path found.' }] };
  const text = [
    `Found project graph path with ${path.nodes.length} node(s).`,
    '',
    ...path.nodes.map((node, index) => [
      `### ${index + 1}. ${node.title}`,
      `ID: ${node.id}`,
      `Kind: ${node.metadata?.['kind'] ?? 'unknown'}`,
      path.edges[index] ? `Next edge: ${path.edges[index].evidence?.['kind'] ?? path.edges[index].relationType}` : null,
    ].filter(Boolean).join('\n')),
  ].join('\n');
  return { content: [{ type: 'text', text }] };
}

export async function handleProjectGraphBlastRadius(
  api: McpApi,
  input: ToolInput,
): Promise<McpToolResponse> {
  const nodes = projectGraphNodes(await api.queryContextGraph({
    project: input.project,
    domainType: ContextDomainType.ARCHITECTURE,
    limit: PROJECT_GRAPH_DEFAULT_QUERY_LIMIT,
  }));
  const edges = projectGraphEdges(await api.listContextEdges({ limit: PROJECT_GRAPH_DEFAULT_QUERY_LIMIT }));
  const root = findProjectGraphNodeInList(nodes, input.id);
  if (!root) return { content: [{ type: 'text', text: 'Project graph node not found.' }], isError: true };

  const affected = collectBlastRadius(nodes, edges, root.id, input.depth ?? 1, input.limit ?? 20);
  const text = [
    `### Blast Radius: ${root.title}`,
    `Affected nodes: ${affected.nodes.length}`,
    `Edges: ${affected.edges.length}`,
    '',
    formatProjectGraphNodes(affected.nodes),
    '',
    '### Connecting Edges',
    formatProjectGraphEdges(affected.edges),
  ].join('\n');
  return { content: [{ type: 'text', text }] };
}

export async function handleProjectGraphAddOverlay(
  api: McpApi,
  input: ToolInput,
): Promise<McpToolResponse> {
  const overlay = await api.createProjectGraphOverlay({
    project: input.project,
    target: input.target,
    targetNodeId: input.targetNodeId,
    targetEdgeId: input.targetEdgeId,
    kind: input.kind as ProjectGraphOverlayKind,
    content: input.content,
    author: input.author,
    source: input.source ?? ProjectGraphOverlaySource.MCP,
  });

  return {
    content: [{
      type: 'text',
      text: [
        'Project graph overlay added.',
        `ID: ${overlay.id}`,
        `Project: ${overlay.project}`,
        overlay.target ? `Target: ${overlay.target}` : null,
        overlay.targetNodeId ? `Target node: ${overlay.targetNodeId}` : null,
        overlay.targetEdgeId ? `Target edge: ${overlay.targetEdgeId}` : null,
        `Kind: ${overlay.kind}`,
        `Source: ${overlay.source}`,
      ].filter(Boolean).join('\n'),
    }],
  };
}

export async function handleProjectGraphReindex(
  api: McpApi,
  input: ToolInput,
): Promise<McpToolResponse> {
  try {
    const result = await api.reindexProjectGraph({ cwd: input.cwd });
    const text = [
      `Project graph reindexed for "${result.project}".`,
      '',
      `Files scanned:   ${result.filesScanned}`,
      `Nodes created:   ${result.nodesCreated}`,
      `Nodes updated:   ${result.nodesUpdated}`,
      `Edges created:   ${result.edgesCreated}`,
      `Edges updated:   ${result.edgesUpdated}`,
      `Edges skipped:   ${result.edgesSkipped} (already up-to-date)`,
    ].join('\n');
    return { content: [{ type: 'text', text }] };
  } catch (err) {
    return {
      content: [{
        type: 'text',
        text: err instanceof Error ? err.message : String(err),
      }],
      isError: true,
    };
  }
}
