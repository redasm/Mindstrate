import {
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
      targetRef: `${node.project ?? 'global'}/${OBSIDIAN_FOLDERS[node.substrateType] ?? 'nodes'}/${slugify(node.title)}.md`,
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
    if (!parsed.id) return { changed: false };

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

const slugify = (value: string): string => value
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, '-')
  .replace(/^-+|-+$/g, '') || 'untitled';
