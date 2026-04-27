import {
  type ContextEdge,
  type ContextNode,
  type PortableContextBundle,
  type PortableContextBundleEdge,
  type PortableContextBundleNode,
} from '@mindstrate/protocol/models';
import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
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

export interface InstallEditableBundleFilesResult extends InstallBundleResult {
  bundle: PortableContextBundle;
  updatedBundleNodes: number;
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

export interface InstallBundleFromRegistryOptions {
  registry: string;
  reference: string;
}

interface BundleRegistryIndex {
  bundles: BundleRegistryEntry[];
}

interface BundleRegistryEntry extends BundlePublicationManifest {
  bundlePath: string;
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

    const manifest: BundlePublicationManifest = {
      id: bundle.id,
      name: bundle.name,
      version: bundle.version,
      registry: options.registry ?? 'local',
      visibility: options.visibility ?? 'unlisted',
      nodeCount: bundle.nodeIds.length,
      edgeCount: bundle.edgeIds.length,
      digest: `sha256:${digest}`,
      publishedAt: new Date().toISOString(),
    };

    if (options.registry && isLocalRegistry(options.registry)) {
      writeBundleToLocalRegistry(options.registry, bundle, manifest);
    }

    return {
      bundle,
      manifest,
    };
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

  installEditableBundleFiles(files: EditableBundleFiles): InstallEditableBundleFilesResult {
    const bundle = readEditableBundle(files);
    const edits = new Map<string, EditableBundleNodeEdit>();
    for (const fileName of ['rules.md', 'skills.md', 'invariants.md']) {
      for (const edit of parseEditableBundleMarkdown(files[fileName] ?? '')) {
        edits.set(edit.id, edit);
      }
    }

    let updatedBundleNodes = 0;
    const nodes = (bundle.nodes ?? []).map((node) => {
      const edit = edits.get(node.id);
      if (!edit) return node;
      updatedBundleNodes++;
      return {
        ...node,
        title: edit.title,
        content: edit.content,
      };
    });

    const editedBundle = {
      ...bundle,
      nodes,
    };
    const install = this.installBundle(editedBundle);
    return {
      ...install,
      bundle: editedBundle,
      updatedBundleNodes,
    };
  }

  installEditableBundleDirectory(directory: string): InstallEditableBundleFilesResult {
    const files: EditableBundleFiles = {};
    for (const fileName of ['bundle.json', 'rules.md', 'skills.md', 'invariants.md']) {
      const filePath = path.join(directory, fileName);
      if (fs.existsSync(filePath)) {
        files[fileName] = fs.readFileSync(filePath, 'utf-8');
      }
    }
    return this.installEditableBundleFiles(files);
  }
}

interface EditableBundleNodeEdit {
  id: string;
  title: string;
  content: string;
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

function readEditableBundle(files: EditableBundleFiles): PortableContextBundle {
  const rawBundle = files['bundle.json'];
  if (!rawBundle) {
    throw new Error('Editable bundle files must include bundle.json');
  }
  return JSON.parse(rawBundle) as PortableContextBundle;
}

function parseEditableBundleMarkdown(markdown: string): EditableBundleNodeEdit[] {
  const edits: EditableBundleNodeEdit[] = [];
  const lines = markdown.split(/\r?\n/);
  let index = 0;

  while (index < lines.length) {
    const heading = lines[index].match(/^##\s+(.+?)\s*$/);
    if (!heading) {
      index++;
      continue;
    }

    const title = heading[1].trim();
    index++;
    const contentLines: string[] = [];
    let id: string | undefined;

    while (index < lines.length && !lines[index].startsWith('## ')) {
      const idMatch = lines[index].match(/^-\s+ID:\s*(.+?)\s*$/);
      if (idMatch) {
        id = idMatch[1].trim();
        index++;
        continue;
      }
      if (id) {
        index++;
        continue;
      }
      contentLines.push(lines[index]);
      index++;
    }

    if (id) {
      edits.push({
        id,
        title,
        content: contentLines.join('\n').trim(),
      });
    }
  }

  return edits;
}

function isLocalRegistry(registry: string): boolean {
  return !/^[a-z][a-z0-9+.-]*:\/\//i.test(registry);
}

function writeBundleToLocalRegistry(
  registry: string,
  bundle: PortableContextBundle,
  manifest: BundlePublicationManifest,
): void {
  const bundleRelativePath = path.join('bundles', bundle.id, bundle.version, 'bundle.json');
  const bundlePath = path.join(registry, bundleRelativePath);
  fs.mkdirSync(path.dirname(bundlePath), { recursive: true });
  fs.writeFileSync(bundlePath, JSON.stringify(bundle, null, 2), 'utf-8');

  const index = readRegistryIndex(registry);
  const entry: BundleRegistryEntry = {
    ...manifest,
    bundlePath: normalizeRegistryPath(bundleRelativePath),
  };
  index.bundles = [
    entry,
    ...index.bundles.filter((item) => !(item.name === entry.name && item.version === entry.version)),
  ];
  fs.mkdirSync(registry, { recursive: true });
  fs.writeFileSync(path.join(registry, 'index.json'), JSON.stringify(index, null, 2), 'utf-8');
}

async function readBundleFromRegistry(registry: string, reference: string): Promise<PortableContextBundle> {
  const index = isLocalRegistry(registry)
    ? readRegistryIndex(registry)
    : await fetchRemoteRegistryIndex(registry);
  const { name, version } = parseBundleReference(reference);
  const candidates = index.bundles.filter((entry) => entry.name === name || entry.id === name);
  const entry = version
    ? candidates.find((item) => item.version === version)
    : candidates.sort((a, b) => compareVersionsDescending(a.version, b.version))[0];

  if (!entry) {
    throw new Error(`Bundle not found in registry: ${reference}`);
  }

  if (isLocalRegistry(registry)) {
    const bundlePath = path.join(registry, entry.bundlePath);
    return JSON.parse(fs.readFileSync(bundlePath, 'utf-8')) as PortableContextBundle;
  }

  return fetchRemoteBundle(registry, entry.bundlePath);
}

function readRegistryIndex(registry: string): BundleRegistryIndex {
  const indexPath = path.join(registry, 'index.json');
  if (!fs.existsSync(indexPath)) {
    return { bundles: [] };
  }

  const parsed = JSON.parse(fs.readFileSync(indexPath, 'utf-8')) as Partial<BundleRegistryIndex>;
  return {
    bundles: Array.isArray(parsed.bundles) ? parsed.bundles : [],
  };
}

function parseBundleReference(reference: string): { name: string; version?: string } {
  const atIndex = reference.lastIndexOf('@');
  if (atIndex <= 0) {
    return { name: reference };
  }
  return {
    name: reference.slice(0, atIndex),
    version: reference.slice(atIndex + 1),
  };
}

function compareVersionsDescending(a: string, b: string): number {
  return b.localeCompare(a, undefined, { numeric: true, sensitivity: 'base' });
}

function normalizeRegistryPath(value: string): string {
  return value.split(path.sep).join('/');
}

async function fetchRemoteRegistryIndex(registry: string): Promise<BundleRegistryIndex> {
  const response = await fetch(new URL('index.json', ensureTrailingSlash(registry)));
  if (!response.ok) {
    throw new Error(`Failed to fetch bundle registry index: ${response.status} ${response.statusText}`);
  }
  const parsed = await response.json() as Partial<BundleRegistryIndex>;
  return {
    bundles: Array.isArray(parsed.bundles) ? parsed.bundles : [],
  };
}

async function fetchRemoteBundle(registry: string, bundlePath: string): Promise<PortableContextBundle> {
  const response = await fetch(new URL(bundlePath, ensureTrailingSlash(registry)));
  if (!response.ok) {
    throw new Error(`Failed to fetch bundle: ${response.status} ${response.statusText}`);
  }
  return await response.json() as PortableContextBundle;
}

function ensureTrailingSlash(value: string): string {
  return value.endsWith('/') ? value : `${value}/`;
}
