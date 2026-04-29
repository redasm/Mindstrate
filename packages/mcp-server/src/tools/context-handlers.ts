import {
  ContextDomainType,
  type ContextEdge,
  type ContextEventType,
  type ContextNode,
  type ContextNodeStatus,
} from '@mindstrate/protocol';
import type { McpApi, McpToolResponse } from '../types.js';
import { appendGraphContextSections } from './memory-handlers.js';

type ToolInput = any;

export async function handleContextIngestEvent(
  api: McpApi,
  input: ToolInput,
): Promise<McpToolResponse> {
  const result = await api.ingestContextEvent({
    ...input,
    type: input.type as ContextEventType,
    domainType: input.domainType as ContextDomainType | undefined,
  });
  return {
    content: [{
      type: 'text',
      text: `Context event ingested.\nEvent ID: ${result.eventId}\nNode ID: ${result.nodeId}`,
    }],
  };
}

export async function handleContextQueryGraph(
  api: McpApi,
  input: ToolInput,
): Promise<McpToolResponse> {
  const nodes = await api.queryContextGraph({
    query: input.query,
    project: input.project,
    substrateType: input.substrateType,
    domainType: input.domainType as ContextDomainType | undefined,
    status: input.status as ContextNodeStatus | undefined,
    limit: input.limit ?? 10,
  });

  if (nodes.length === 0) {
    return {
      content: [{ type: 'text', text: 'No ECS context graph nodes matched the query.' }],
    };
  }

  const formatted = nodes.map((node, index) => [
    `### ${index + 1}. [${node.substrateType}] ${node.title}`,
    `Domain: ${node.domainType} | Status: ${node.status} | Quality: ${node.qualityScore.toFixed(0)}`,
    node.project ? `Project: ${node.project}` : null,
    `Tags: ${node.tags.join(', ') || '(none)'}`,
    `ID: ${node.id}`,
  ].filter(Boolean).join('\n')).join('\n---\n\n');

  return {
    content: [{
      type: 'text',
      text: `Found ${nodes.length} ECS context nodes:\n\n${formatted}`,
    }],
  };
}

export async function handleContextEdges(
  api: McpApi,
  input: ToolInput,
): Promise<McpToolResponse> {
  const edges = await api.listContextEdges({
    sourceId: input.sourceId,
    targetId: input.targetId,
    relationType: input.relationType,
    limit: input.limit ?? 20,
  });

  if (edges.length === 0) {
    return {
      content: [{ type: 'text', text: 'No ECS context edges matched the query.' }],
    };
  }

  const formatted = edges.map((edge, index) => [
    `### ${index + 1}. ${edge.relationType}`,
    `Source: ${edge.sourceId}`,
    `Target: ${edge.targetId}`,
    `Strength: ${edge.strength.toFixed(2)}`,
    `ID: ${edge.id}`,
  ].join('\n')).join('\n---\n\n');

  return {
    content: [{
      type: 'text',
      text: `Found ${edges.length} ECS edges:\n\n${formatted}`,
    }],
  };
}

export async function handleContextConflicts(
  api: McpApi,
  input: ToolInput,
): Promise<McpToolResponse> {
  const conflicts = await api.listContextConflicts({
    project: input.project,
    limit: input.limit ?? 20,
  });

  if (conflicts.length === 0) {
    return {
      content: [{ type: 'text', text: 'No active ECS conflicts found.' }],
    };
  }

  const formatted = conflicts.map((conflict, index) => [
    `### ${index + 1}. ${conflict.reason}`,
    conflict.project ? `Project: ${conflict.project}` : null,
    `Nodes: ${conflict.nodeIds.join(', ')}`,
    `Detected: ${conflict.detectedAt}`,
    conflict.resolution ? `Resolution: ${conflict.resolution}` : null,
  ].filter(Boolean).join('\n')).join('\n---\n\n');

  return {
    content: [{
      type: 'text',
      text: `Found ${conflicts.length} ECS conflicts:\n\n${formatted}`,
    }],
  };
}

export async function handleContextConflictAccept(
  api: McpApi,
  input: ToolInput,
): Promise<McpToolResponse> {
  const result = await api.acceptConflictCandidate(input);
  return {
    content: [{
      type: 'text',
      text: result.resolved
        ? `Conflict resolved.\nID: ${result.resolved.id}\nResolution: ${result.resolved.resolution ?? input.resolution}`
        : `Conflict candidate was not accepted: ${input.candidateNodeId}`,
    }],
    isError: result.resolved ? undefined : true,
  };
}

export async function handleContextConflictReject(
  api: McpApi,
  input: ToolInput,
): Promise<McpToolResponse> {
  await api.rejectConflictCandidate(input);
  return {
    content: [{
      type: 'text',
      text: `Conflict candidate rejected.\nConflict: ${input.conflictId}\nCandidate: ${input.candidateNodeId}`,
    }],
  };
}

export async function handleContextAssemble(
  api: McpApi,
  input: ToolInput,
): Promise<McpToolResponse> {
  const { task, project, language, framework } = input;

  const assembled = await api.assembleContext(task, {
    project,
    context: {
      project,
      currentLanguage: language,
      currentFramework: framework,
    },
  });

  let text = assembled.summary;
  if (assembled.projectSnapshot) {
    text += `\n\n### Project Snapshot ID\n- ${assembled.projectSnapshot.id}\n`;
  }
  text = appendGraphContextSections(text, assembled);

  return { content: [{ type: 'text', text }] };
}

export async function handleContextInternalize(
  api: McpApi,
  input: ToolInput,
): Promise<McpToolResponse> {
  const accepted = input.accept
    ? await api.acceptInternalizationSuggestions(input)
    : undefined;
  const suggestions = accepted ?? await api.generateInternalizationSuggestions(input);
  const projectionRecordCount = accepted?.records.length;
  const text = [
    input.accept ? '### Accepted Internalization' : '### Internalization Suggestions',
    '',
    '### AGENTS.md Suggestion',
    suggestions.agentsMd,
    '',
    '### Project Snapshot Fragment',
    suggestions.projectSnapshotFragment,
    '',
    '### System Prompt Fragment',
    suggestions.systemPromptFragment,
    '',
    '### Fine-Tune Dataset JSONL',
    suggestions.fineTuneDatasetJsonl,
    '',
    `Source Node IDs: ${suggestions.sourceNodeIds.join(', ') || '(none)'}`,
    projectionRecordCount !== undefined ? `Projection Records: ${projectionRecordCount}` : '',
  ].join('\n');

  return { content: [{ type: 'text', text }] };
}

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
  const text = [
    `### ${node.title}`,
    `Kind: ${node.metadata?.['kind'] ?? 'unknown'}`,
    `Provenance: ${node.metadata?.['provenance'] ?? 'unknown'}`,
    `Evidence: ${evidencePaths(node).join(', ') || '(none)'}`,
    `Incoming project graph edges: ${incoming.length}`,
    `Outgoing project graph edges: ${outgoing.length}`,
    '',
    'Suggested next queries:',
    `- get_project_graph_neighbors id="${node.id}"`,
    `- query_project_graph query="${node.title}"`,
  ].join('\n');
  return { content: [{ type: 'text', text }] };
}

const findProjectGraphNode = async (
  api: McpApi,
  id: string,
  project?: string,
): Promise<ContextNode | null> => {
  const nodes = projectGraphNodes(await api.queryContextGraph({
    project,
    domainType: ContextDomainType.ARCHITECTURE,
    limit: 100000,
  }));
  return nodes.find((node) => node.id === id || node.title === id) ?? null;
};

const projectGraphNodes = (nodes: ContextNode[]): ContextNode[] =>
  nodes.filter((node) => node.metadata?.['projectGraph'] === true);

const projectGraphEdges = (edges: ContextEdge[]): ContextEdge[] =>
  edges.filter((edge) => edge.evidence?.['projectGraph'] === true);

const formatProjectGraphNodes = (nodes: ContextNode[]): string => [
  `Found ${nodes.length} project graph node(s).`,
  '',
  ...nodes.map((node, index) => [
    `### ${index + 1}. ${node.title}`,
    `ID: ${node.id}`,
    `Kind: ${node.metadata?.['kind'] ?? 'unknown'}`,
    `Provenance: ${node.metadata?.['provenance'] ?? 'unknown'}`,
    `Evidence: ${evidencePaths(node).join(', ') || '(none)'}`,
  ].join('\n')),
  '',
  'Suggested next queries:',
  '- get_project_graph_neighbors id="<node id>"',
  '- explain_project_graph_node id="<node id>"',
].join('\n');

const formatProjectGraphEdges = (edges: ContextEdge[]): string =>
  edges.length === 0
    ? '- None'
    : edges.map((edge) => `- ${edge.evidence?.['kind'] ?? edge.relationType}: ${edge.sourceId} -> ${edge.targetId}`).join('\n');

const evidencePaths = (node: ContextNode): string[] => {
  const evidence = node.metadata?.['evidence'];
  return Array.isArray(evidence)
    ? evidence.map((entry) => typeof entry === 'object' && entry && 'path' in entry ? String(entry.path) : '')
      .filter(Boolean)
    : [];
};
