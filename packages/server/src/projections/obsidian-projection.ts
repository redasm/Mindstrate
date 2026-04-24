import {
  ContextNodeStatus,
  ProjectionTarget,
  SubstrateType,
  type ContextNode,
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

const slugify = (value: string): string => value
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, '-')
  .replace(/^-+|-+$/g, '') || 'untitled';
