import type { ContextEdge, ContextNode, ProjectGraphOverlay } from '@mindstrate/protocol';

export const formatProjectGraphNodes = (nodes: ContextNode[]): string => [
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

export const formatProjectGraphEdges = (edges: ContextEdge[]): string =>
  edges.length === 0
    ? '- None'
    : edges.map((edge) => `- ${edge.evidence?.['kind'] ?? edge.relationType}: ${edge.sourceId} -> ${edge.targetId}`).join('\n');

export const formatProjectGraphOverlays = (overlays: ProjectGraphOverlay[]): string =>
  overlays.length === 0
    ? '- None'
    : overlays.map((overlay) => [
      `- [${overlay.kind}] ${overlay.content}`,
      `  Source: ${overlay.source} | Author: ${overlay.author ?? '(unknown)'} | ID: ${overlay.id}`,
    ].join('\n')).join('\n');

export const evidencePaths = (node: ContextNode): string[] => {
  const evidence = node.metadata?.['evidence'];
  return Array.isArray(evidence)
    ? evidence.map((entry) => typeof entry === 'object' && entry && 'path' in entry ? String(entry.path) : '')
      .filter(Boolean)
    : [];
};
