import type { ContextEdge, ContextNode } from '@mindstrate/protocol/models';
import { ContextEdgeRepository } from './context-edge-repository.js';
import { ContextNodeRepository } from './context-node-repository.js';

export interface GraphNeighborhood {
  center: ContextNode | null;
  outgoingEdges: ContextEdge[];
  incomingEdges: ContextEdge[];
  outgoingNodes: ContextNode[];
  incomingNodes: ContextNode[];
}

export class GraphQuery {
  constructor(
    private readonly nodes: ContextNodeRepository,
    private readonly edges: ContextEdgeRepository,
  ) {}

  neighborhood(nodeId: string): GraphNeighborhood {
    const outgoingEdges = this.edges.listOutgoing(nodeId);
    const incomingEdges = this.edges.listIncoming(nodeId);

    return {
      center: this.nodes.getById(nodeId),
      outgoingEdges,
      incomingEdges,
      outgoingNodes: outgoingEdges
        .map((edge) => this.nodes.getById(edge.targetId))
        .filter((node): node is ContextNode => node !== null),
      incomingNodes: incomingEdges
        .map((edge) => this.nodes.getById(edge.sourceId))
        .filter((node): node is ContextNode => node !== null),
    };
  }
}
