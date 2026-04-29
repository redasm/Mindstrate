import {
  PROJECT_GRAPH_DEFAULT_QUERY_LIMIT,
  isProjectGraphEdge,
  isProjectGraphNode,
  type ContextEdge,
  type ContextNode,
} from '@mindstrate/server';

export const PROJECT_GRAPH_CLI_QUERY_LIMIT = PROJECT_GRAPH_DEFAULT_QUERY_LIMIT;

export const projectGraphNodes = (nodes: ContextNode[]): ContextNode[] =>
  nodes.filter(isProjectGraphNode);

export const projectGraphEdges = (edges: ContextEdge[]): ContextEdge[] =>
  edges.filter(isProjectGraphEdge);
