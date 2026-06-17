import {
  ContextDomainType,
  ProjectGraphOverlaySource,
  type ContextEdge,
  type ContextNode,
  type ProjectGraphOverlayKind,
} from '@mindstrate/protocol';
import type { McpApi, McpToolResponse } from '../types.js';
import { assertProjectAllowed } from '../allowed-projects.js';
import {
  evidencePaths,
  formatProjectGraphEdges,
  formatProjectGraphNodes,
  formatProjectGraphOverlays,
} from './project-graph-render.js';
import {
  collectTaskQuerySeeds,
  findProjectGraphNode,
  loadSystemPageRules,
  projectGraphEdges,
  projectGraphNodes,
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
  const limit = input.limit ?? 10;

  // Bounded working set instead of the old `queryContextGraph({limit:100000})`
  // + `listContextEdges({limit:100000})` full-graph pull (which timed out over
  // HTTP in team mode). `entry-points` needs the file layer; every other task
  // is seed-driven, so we resolve seeds with a bounded text query and then ask
  // the server for just their neighbourhood.
  let workingNodes: ContextNode[];
  let workingEdges: ContextEdge[];
  let seeds: ContextNode[];
  if (input.task === 'entry-points') {
    const sub = await api.queryProjectSubgraph({ project: input.project, kinds: ['file'], limit: 500 });
    workingNodes = projectGraphNodes(sub.nodes);
    workingEdges = projectGraphEdges(sub.edges);
    seeds = [];
  } else {
    const candidates = projectGraphNodes(await api.queryContextGraph({
      query: input.query,
      project: input.project,
      domainType: ContextDomainType.ARCHITECTURE,
      limit: 200,
    }));
    seeds = collectTaskQuerySeeds(candidates, input.query);
    if (seeds.length === 0) {
      workingNodes = candidates;
      workingEdges = [];
    } else {
      const hood = await api.projectGraphNeighborhood({
        project: input.project,
        seedIds: seeds.map((node) => node.id),
        depth: 2,
        limit: 500,
      });
      workingNodes = projectGraphNodes(hood.nodes);
      workingEdges = projectGraphEdges(hood.edges);
    }
  }

  const selected = selectTaskNodes(input.task, workingNodes, workingEdges, seeds).slice(0, limit);
  const evidence = Array.from(new Set(selected.flatMap(evidencePaths))).slice(0, limit);
  if (input.task === 'before-edit' || input.task === 'impact') {
    const overlays = await api.listProjectGraphOverlays({ project: input.project, limit: 100 });
    const systemPageRules = await loadSystemPageRules(api, input.project);
    const report = buildBeforeEditReport({
      task: input.task,
      query: input.query,
      nodes: workingNodes,
      edges: workingEdges,
      selected,
      evidence,
      overlays,
      systemPageRules,
      limit,
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
  // Resolve endpoints to ids (callers may pass a title / path) with bounded
  // lookups, then let the server do the BFS instead of pulling the whole graph.
  const [from, to] = await Promise.all([
    findProjectGraphNode(api, input.from, input.project),
    findProjectGraphNode(api, input.to, input.project),
  ]);
  if (!from || !to) {
    return { content: [{ type: 'text', text: 'No project graph path found (unknown endpoint).' }] };
  }
  const path = await api.projectGraphPath({
    project: input.project,
    from: from.id,
    to: to.id,
    maxDepth: input.maxDepth ?? 6,
  });
  if (!path || path.nodes.length === 0) {
    return { content: [{ type: 'text', text: 'No project graph path found.' }] };
  }
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
  const root = await findProjectGraphNode(api, input.id, input.project);
  if (!root) return { content: [{ type: 'text', text: 'Project graph node not found.' }], isError: true };

  // Server-side bounded BFS instead of pulling 100k nodes + 100k edges.
  const hood = await api.projectGraphNeighborhood({
    project: input.project,
    seedIds: [root.id],
    depth: input.depth ?? 1,
    limit: input.limit ?? 20,
  });
  const affectedNodes = projectGraphNodes(hood.nodes).filter((node) => node.id !== root.id);
  const affectedEdges = projectGraphEdges(hood.edges);
  const text = [
    `### Blast Radius: ${root.title}`,
    `Affected nodes: ${affectedNodes.length}`,
    `Edges: ${affectedEdges.length}`,
    '',
    formatProjectGraphNodes(affectedNodes),
    '',
    '### Connecting Edges',
    formatProjectGraphEdges(affectedEdges),
  ].join('\n');
  return { content: [{ type: 'text', text }] };
}

export async function handleProjectGraphAddOverlay(
  api: McpApi,
  input: ToolInput,
): Promise<McpToolResponse> {
  assertProjectAllowed(input.project);
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
