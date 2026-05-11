import {
  ContextDomainType,
  ContextEventType,
  ContextNodeStatus,
  ContextRelationType,
  ProjectionTarget,
  SubstrateType,
  type ContextNode,
  type ContextEvent,
  type ProjectionRecord,
} from '@mindstrate/protocol/models';
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { ContextGraphStore } from '../context-graph/context-graph-store.js';
import { slugifyAscii } from '../processing/slug.js';

export interface ObsidianProjectionOptions {
  project?: string;
  limit?: number;
}

export interface ObsidianProjectionWriteOptions extends ObsidianProjectionOptions {
  rootDir: string;
}

export interface ObsidianProjectionImportResult {
  sourceNodeId?: string;
  candidateNode?: ContextNode;
  event?: ContextEvent;
  changed: boolean;
}

const OBSIDIAN_FOLDERS: Partial<Record<SubstrateType, string>> = {
  [SubstrateType.RULE]: 'rules',
  [SubstrateType.HEURISTIC]: 'heuristics',
  [SubstrateType.AXIOM]: 'axioms',
  [SubstrateType.SKILL]: 'skills',
};

export class ObsidianProjectionMaterializer {
  constructor(private readonly graphStore: ContextGraphStore) {}

  materialize(options: ObsidianProjectionOptions = {}): ProjectionRecord[] {
    const nodes = this.loadProjectableNodes(options);

    return nodes.slice(0, options.limit ?? 100).map((node, index) => this.graphStore.upsertProjectionRecord({
      id: `projection:${ProjectionTarget.OBSIDIAN_DOCUMENT}:${node.id}`,
      nodeId: node.id,
      target: ProjectionTarget.OBSIDIAN_DOCUMENT,
      targetRef: `${node.project ?? 'global'}/${OBSIDIAN_FOLDERS[node.substrateType] ?? 'nodes'}/${slugifyAscii(node.title)}.md`,
      version: index + 1,
    }));
  }

  writeFiles(options: ObsidianProjectionWriteOptions): string[] {
    const records = this.materialize(options);
    const written: string[] = [];

    for (const record of records) {
      const node = this.graphStore.getNodeById(record.nodeId);
      if (!node) continue;

      const filePath = path.join(options.rootDir, ...record.targetRef.split('/'));
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      fs.writeFileSync(filePath, serializeObsidianNode(node), 'utf8');
      written.push(filePath);
    }

    return written;
  }

  importFile(filePath: string): ObsidianProjectionImportResult {
    const parsed = parseObsidianNodeMarkdown(fs.readFileSync(filePath, 'utf8'));
    if (!parsed.id) return this.importPlainArchitectureMarkdown(filePath, parsed);

    const source = this.graphStore.getNodeById(parsed.id);
    if (!source) return { sourceNodeId: parsed.id, changed: false };
    if (source.content.trim() === parsed.content.trim() && source.title === parsed.title) {
      return { sourceNodeId: source.id, changed: false };
    }

    const event = this.graphStore.createEvent({
      type: ContextEventType.USER_EDIT,
      project: source.project,
      actor: 'obsidian-projection',
      content: `Obsidian projection edit for ${source.title}`,
      metadata: {
        sourceNodeId: source.id,
        filePath,
      },
    });
    const candidateNode = this.graphStore.createNode({
      substrateType: source.substrateType,
      domainType: source.domainType,
      title: parsed.title,
      content: parsed.content,
      tags: Array.from(new Set([...source.tags, 'obsidian-edit-candidate'])),
      project: source.project,
      compressionLevel: source.compressionLevel,
      confidence: Math.min(source.confidence, 0.7),
      qualityScore: Math.min(source.qualityScore, 70),
      status: ContextNodeStatus.CANDIDATE,
      sourceRef: source.id,
      metadata: {
        sourceNodeId: source.id,
        userEditEventId: event.id,
        filePath,
      },
    });
    this.graphStore.createEdge({
      sourceId: source.id,
      targetId: candidateNode.id,
      relationType: ContextRelationType.DERIVED_FROM,
      strength: 1,
      evidence: {
        eventId: event.id,
        filePath,
      },
    });

    return {
      sourceNodeId: source.id,
      candidateNode,
      event,
      changed: true,
    };
  }

  private importPlainArchitectureMarkdown(
    filePath: string,
    parsed: { title: string; content: string },
  ): ObsidianProjectionImportResult {
    const architectureSource = architectureSourceFromPath(filePath);
    if (!architectureSource) return { changed: false };

    const sourceRef = normalizePath(filePath);
    const id = `obsidian-architecture:${architectureSource.project}:${slugifyAscii(architectureSource.relativePath)}`;
    const tags = architectureTags(parsed.content);
    const existing = this.graphStore.getNodeById(id) ?? this.graphStore.listNodes({
      project: architectureSource.project,
      sourceRef,
      limit: 1,
    })[0];

    if (!existing) {
      const node = this.graphStore.createNode({
        id,
        substrateType: SubstrateType.RULE,
        domainType: ContextDomainType.ARCHITECTURE,
        title: parsed.title,
        content: parsed.content,
        tags,
        project: architectureSource.project,
        compressionLevel: 0.1,
        confidence: 0.9,
        qualityScore: 90,
        status: ContextNodeStatus.VERIFIED,
        sourceRef,
        metadata: {
          importer: 'obsidian-architecture-markdown',
          relativePath: architectureSource.relativePath,
        },
      });
      return { sourceNodeId: node.id, candidateNode: node, changed: true };
    }

    if (existing.title === parsed.title && existing.content.trim() === parsed.content.trim()) {
      return { sourceNodeId: existing.id, candidateNode: existing, changed: false };
    }

    const node = this.graphStore.updateNode(existing.id, {
      title: parsed.title,
      content: parsed.content,
      tags,
      project: architectureSource.project,
      confidence: Math.max(existing.confidence, 0.9),
      qualityScore: Math.max(existing.qualityScore, 90),
      status: ContextNodeStatus.VERIFIED,
      sourceRef,
      metadata: {
        ...(existing.metadata ?? {}),
        importer: 'obsidian-architecture-markdown',
        relativePath: architectureSource.relativePath,
      },
    });

    return { sourceNodeId: node?.id ?? existing.id, candidateNode: node ?? existing, changed: true };
  }

  private loadProjectableNodes(options: ObsidianProjectionOptions): ContextNode[] {
    return [
      ...this.loadStableNodes(SubstrateType.RULE, options),
      ...this.loadStableNodes(SubstrateType.HEURISTIC, options),
      ...this.loadStableNodes(SubstrateType.AXIOM, options),
      ...this.loadStableNodes(SubstrateType.SKILL, options),
    ];
  }

  private loadStableNodes(substrateType: SubstrateType, options: ObsidianProjectionOptions) {
    return this.graphStore.listNodes({
      project: options.project,
      substrateType,
      status: ContextNodeStatus.VERIFIED,
      limit: options.limit ?? 100,
    });
  }
}

const serializeObsidianNode = (node: ContextNode): string => [
  '---',
  `id: ${node.id}`,
  `substrateType: ${node.substrateType}`,
  `domainType: ${node.domainType}`,
  `status: ${node.status}`,
  node.project ? `project: ${node.project}` : undefined,
  `tags: [${node.tags.join(', ')}]`,
  '---',
  '',
  `# ${node.title}`,
  '',
  node.content,
  '',
].filter((line) => line !== undefined).join('\n');

const architectureSourceFromPath = (filePath: string): { project: string; relativePath: string } | null => {
  const normalized = normalizePath(filePath);
  if (!normalized.toLowerCase().endsWith('.md')) return null;
  const parts = normalized.split('/').filter(Boolean);
  const architectureIndex = parts.findIndex((part) => part.toLowerCase() === 'architecture');
  if (architectureIndex <= 0) return null;
  const project = parts[architectureIndex - 1];
  return {
    project,
    relativePath: parts.slice(architectureIndex - 1).join('/'),
  };
};

const architectureTags = (content: string): string[] => {
  const normalized = content.toLowerCase();
  const tags = new Set(['obsidian-architecture', 'architecture']);
  if (normalized.includes('typescript/typing') || normalized.includes('generated')) tags.add('generated-output');
  if (normalized.includes('do not edit') || normalized.includes('never edit') || normalized.includes('不能') || normalized.includes('不要')) tags.add('do-not-edit');
  if (normalized.includes('runtime') && normalized.includes('editor')) tags.add('runtime-editor-boundary');
  if (normalized.includes('source of truth') || normalized.includes('source-of-truth')) tags.add('source-of-truth');
  if (normalized.includes('validation') || normalized.includes('verify') || normalized.includes('验证')) tags.add('validation');
  if (normalized.includes('high-risk') || normalized.includes('高风险')) tags.add('high-risk');
  return Array.from(tags);
};

const normalizePath = (filePath: string): string => filePath.replace(/\\/g, '/');

const parseObsidianNodeMarkdown = (text: string): { id?: string; title: string; content: string } => {
  const normalized = text.replace(/\r\n/g, '\n');
  const frontmatterMatch = normalized.match(/^---\n([\s\S]*?)\n---\n?/);
  const frontmatter = frontmatterMatch?.[1] ?? '';
  const body = frontmatterMatch ? normalized.slice(frontmatterMatch[0].length) : normalized;
  const id = frontmatter.split('\n')
    .map((line) => line.trim())
    .find((line) => line.startsWith('id:'))
    ?.slice(3)
    .trim();
  const lines = body.split('\n');
  const titleLineIndex = lines.findIndex((line) => line.startsWith('# '));
  const title = titleLineIndex >= 0
    ? lines[titleLineIndex].slice(2).trim()
    : 'Untitled projection edit';
  const content = titleLineIndex >= 0
    ? lines.slice(titleLineIndex + 1).join('\n').trim()
    : body.trim();

  return { id, title, content };
};
