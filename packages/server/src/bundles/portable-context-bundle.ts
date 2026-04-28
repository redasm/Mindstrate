import {
  type ContextEdge,
  type ContextNode,
  type PortableContextBundle,
  type PortableContextBundleEdge,
  type PortableContextBundleNode,
} from '@mindstrate/protocol/models';
import type {
  BundlePublicationManifest,
  InstallBundleResult,
  PublishBundleOptions,
  PublishBundleResult,
} from '@mindstrate/protocol';
import type { ContextGraphStore } from '../context-graph/context-graph-store.js';
import { slugifyAscii } from '../text-format.js';
import {
  type InstallBundleFromRegistryOptions,
  publishBundleToRegistry,
  readBundleFromRegistry,
} from './bundle-registry.js';
import {
  type EditableBundleFiles,
  type InstallEditableBundleFilesResult,
  createEditableBundleFiles,
  installEditableBundleDirectory,
  installEditableBundleFiles,
} from './editable-bundle-files.js';

export type {
  BundlePublicationManifest,
  InstallBundleResult,
  PublishBundleOptions,
  PublishBundleResult,
} from '@mindstrate/protocol';

export interface CreateBundleOptions {
  bundleId?: string;
  name: string;
  version?: string;
  description?: string;
  project?: string;
  nodeIds?: string[];
  includeRelatedEdges?: boolean;
}

export interface ValidateBundleResult {
  valid: boolean;
  errors: string[];
}

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
      id: options.bundleId ?? slugifyAscii(options.name, ''),
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

    return publishBundleToRegistry(bundle, options);
  }

  async installBundleFromRegistry(options: InstallBundleFromRegistryOptions): Promise<InstallBundleResult> {
    const bundle = await readBundleFromRegistry(options.registry, options.reference);
    return this.installBundle(bundle);
  }

  createEditableBundleFiles(bundle: PortableContextBundle): EditableBundleFiles {
    const validation = this.validateBundle(bundle);
    if (!validation.valid) {
      throw new Error(`Invalid bundle: ${validation.errors.join('; ')}`);
    }

    return createEditableBundleFiles(bundle);
  }

  installEditableBundleFiles(files: EditableBundleFiles): InstallEditableBundleFilesResult {
    return installEditableBundleFiles(files, (bundle) => this.installBundle(bundle));
  }

  installEditableBundleDirectory(directory: string): InstallEditableBundleFilesResult {
    return installEditableBundleDirectory(directory, (bundle) => this.installBundle(bundle));
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
