import {
  type ContextEdge,
  type ContextNode,
  type PortableContextBundle,
  type PortableContextBundleEdge,
  type PortableContextBundleNode,
} from '@mindstrate/protocol/models';
import { createHash } from 'node:crypto';
import type { ContextGraphStore } from '../context-graph/context-graph-store.js';

export interface CreateBundleOptions {
  bundleId?: string;
  name: string;
  version?: string;
  description?: string;
  project?: string;
  nodeIds?: string[];
  includeRelatedEdges?: boolean;
}

export interface InstallBundleResult {
  installedNodes: number;
  updatedNodes: number;
  installedEdges: number;
  skippedEdges: number;
}

export interface ValidateBundleResult {
  valid: boolean;
  errors: string[];
}

export interface PublishBundleOptions {
  registry?: string;
  visibility?: 'public' | 'private' | 'unlisted';
}

export interface BundlePublicationManifest {
  id: string;
  name: string;
  version: string;
  registry: string;
  visibility: 'public' | 'private' | 'unlisted';
  nodeCount: number;
  edgeCount: number;
  digest: string;
  publishedAt: string;
}

export interface PublishBundleResult {
  bundle: PortableContextBundle;
  manifest: BundlePublicationManifest;
}

export type EditableBundleFiles = Record<string, string>;

export class PortableContextBundleManager {
  private readonly graphStore: ContextGraphStore;

  constructor(graphStore: ContextGraphStore) {
    this.graphStore = graphStore;
  }

  createBundle(options: CreateBundleOptions): PortableContextBundle {
    const nodes = options.nodeIds?.length
      ? options.nodeIds
          .map((id) => this.graphStore.getNodeById(id))
          .filter((node): node is ContextNode => Boolean(node))
      : this.graphStore.listNodes({
          project: options.project,
          limit: 1000,
        });

    const nodeIds = new Set(nodes.map((node) => node.id));
    const edges = options.includeRelatedEdges === false
      ? []
      : this.graphStore.listEdges({ limit: 5000 }).filter((edge) =>
          nodeIds.has(edge.sourceId) && nodeIds.has(edge.targetId)
        );

    return {
      id: options.bundleId ?? slugify(options.name),
      name: options.name,
      version: options.version ?? '0.1.0',
      description: options.description,
      projectScoped: Boolean(options.project),
      nodeIds: nodes.map((node) => node.id),
      edgeIds: edges.map((edge) => edge.id),
      exportedAt: new Date().toISOString(),
      nodes: nodes.map(serializeNode),
      edges: edges.map(serializeEdge),
    };
  }

  validateBundle(bundle: PortableContextBundle): ValidateBundleResult {
    const errors: string[] = [];
    if (!bundle.id) errors.push('bundle.id is required');
    if (!bundle.name) errors.push('bundle.name is required');
    if (!bundle.version) errors.push('bundle.version is required');
    if (!Array.isArray(bundle.nodeIds)) errors.push('bundle.nodeIds must be an array');
    if (!Array.isArray(bundle.edgeIds)) errors.push('bundle.edgeIds must be an array');
    if (!Array.isArray(bundle.nodes) || bundle.nodes.length === 0) errors.push('bundle.nodes must contain at least one node');
    if (!Array.isArray(bundle.edges)) errors.push('bundle.edges must be an array');

    const nodeIds = new Set((bundle.nodes ?? []).map((node) => node.id));
    for (const edge of bundle.edges ?? []) {
      if (!nodeIds.has(edge.sourceId)) {
        errors.push(`edge ${edge.id} references missing source node ${edge.sourceId}`);
      }
      if (!nodeIds.has(edge.targetId)) {
        errors.push(`edge ${edge.id} references missing target node ${edge.targetId}`);
      }
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }

  installBundle(bundle: PortableContextBundle): InstallBundleResult {
    const validation = this.validateBundle(bundle);
    if (!validation.valid) {
      throw new Error(`Invalid bundle: ${validation.errors.join('; ')}`);
    }

    let installedNodes = 0;
    let updatedNodes = 0;
    let installedEdges = 0;
    let skippedEdges = 0;

    for (const node of bundle.nodes ?? []) {
      const existing = this.graphStore.getNodeById(node.id);
      if (existing) {
        this.graphStore.updateNode(node.id, {
          title: node.title,
          content: node.content,
          tags: node.tags,
          project: node.project,
          compressionLevel: node.compressionLevel,
          confidence: node.confidence,
          qualityScore: node.qualityScore,
          status: node.status as never,
          sourceRef: node.sourceRef,
          metadata: node.metadata,
        });
        updatedNodes++;
      } else {
        this.graphStore.createNode({
          id: node.id,
          substrateType: node.substrateType as never,
          domainType: node.domainType as never,
          title: node.title,
          content: node.content,
          tags: node.tags,
          project: node.project,
          compressionLevel: node.compressionLevel,
          confidence: node.confidence,
          qualityScore: node.qualityScore,
          status: node.status as never,
          sourceRef: node.sourceRef,
          metadata: node.metadata,
        });
        installedNodes++;
      }
    }

    for (const edge of bundle.edges ?? []) {
      const existing = this.graphStore.getEdgeById(edge.id);
      if (existing) {
        skippedEdges++;
        continue;
      }
      this.graphStore.createEdge({
        id: edge.id,
        sourceId: edge.sourceId,
        targetId: edge.targetId,
        relationType: edge.relationType as never,
        strength: edge.strength,
        evidence: edge.evidence,
      });
      installedEdges++;
    }

    return {
      installedNodes,
      updatedNodes,
      installedEdges,
      skippedEdges,
    };
  }

  publishBundle(bundle: PortableContextBundle, options: PublishBundleOptions = {}): PublishBundleResult {
    const validation = this.validateBundle(bundle);
    if (!validation.valid) {
      throw new Error(`Invalid bundle: ${validation.errors.join('; ')}`);
    }

    const digest = createHash('sha256')
      .update(JSON.stringify(bundle))
      .digest('hex');

    return {
      bundle,
      manifest: {
        id: bundle.id,
        name: bundle.name,
        version: bundle.version,
        registry: options.registry ?? 'local',
        visibility: options.visibility ?? 'unlisted',
        nodeCount: bundle.nodeIds.length,
        edgeCount: bundle.edgeIds.length,
        digest: `sha256:${digest}`,
        publishedAt: new Date().toISOString(),
      },
    };
  }

  createEditableBundleFiles(bundle: PortableContextBundle): EditableBundleFiles {
    const validation = this.validateBundle(bundle);
    if (!validation.valid) {
      throw new Error(`Invalid bundle: ${validation.errors.join('; ')}`);
    }

    return {
      'bundle.json': JSON.stringify(bundle, null, 2),
      'rules.md': formatBundleMarkdown('Rules', bundle.nodes?.filter((node) => node.substrateType === 'rule') ?? []),
      'skills.md': formatBundleMarkdown('Skills', bundle.nodes?.filter((node) => node.substrateType === 'skill') ?? []),
      'invariants.md': formatBundleMarkdown(
        'Invariants',
        bundle.nodes?.filter((node) => ['heuristic', 'axiom'].includes(node.substrateType)) ?? [],
      ),
    };
  }
}

function serializeNode(node: ContextNode): PortableContextBundleNode {
  return {
    id: node.id,
    substrateType: node.substrateType,
    domainType: node.domainType,
    title: node.title,
    content: node.content,
    tags: node.tags,
    project: node.project,
    compressionLevel: node.compressionLevel,
    confidence: node.confidence,
    qualityScore: node.qualityScore,
    status: node.status,
    sourceRef: node.sourceRef,
    metadata: node.metadata,
  };
}

function serializeEdge(edge: ContextEdge): PortableContextBundleEdge {
  return {
    id: edge.id,
    sourceId: edge.sourceId,
    targetId: edge.targetId,
    relationType: edge.relationType,
    strength: edge.strength,
    evidence: edge.evidence,
  };
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function formatBundleMarkdown(
  title: string,
  nodes: PortableContextBundleNode[],
): string {
  const lines = [`# ${title}`, ''];
  if (nodes.length === 0) {
    lines.push('_No entries in this bundle._');
    return lines.join('\n');
  }

  for (const node of nodes) {
    lines.push(`## ${node.title}`);
    lines.push('');
    lines.push(node.content);
    lines.push('');
    lines.push(`- ID: ${node.id}`);
    lines.push(`- Domain: ${node.domainType}`);
    lines.push(`- Status: ${node.status}`);
    if (node.tags.length > 0) {
      lines.push(`- Tags: ${node.tags.join(', ')}`);
    }
    lines.push('');
  }

  return lines.join('\n').trimEnd() + '\n';
}
