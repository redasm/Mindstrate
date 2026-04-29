import {
  ContextDomainType,
  type ContextEventType,
  type ContextNodeStatus,
} from '@mindstrate/protocol';
import type { McpApi, McpToolResponse } from '../types.js';
export {
  handleContextAssemble,
  handleContextInternalize,
} from './context-assembly-handlers.js';
export {
  handleProjectGraphAddOverlay,
  handleProjectGraphBlastRadius,
  handleProjectGraphExplainNode,
  handleProjectGraphGetNeighbors,
  handleProjectGraphGetNode,
  handleProjectGraphPath,
  handleProjectGraphQuery,
} from './project-graph-handlers.js';

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
