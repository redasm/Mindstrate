import {
  ContextNodeStatus,
  ProjectionTarget,
  SubstrateType,
  type ContextNode,
  type ProjectionRecord,
} from '@mindstrate/protocol/models';
import type { ContextGraphStore } from '../context-graph/context-graph-store.js';

export interface BestSkillProjectionOptions {
  project?: string;
  limit?: number;
}

export interface BestSkillArtifact {
  markdown: string;
  records: ProjectionRecord[];
  sourceNodeIds: string[];
}

export class BestSkillProjectionMaterializer {
  constructor(private readonly graphStore: ContextGraphStore) {}

  render(options: BestSkillProjectionOptions = {}): BestSkillArtifact {
    const nodes = this.loadSkillNodes(options);
    const projectLabel = options.project ?? 'global';
    const generatedAt = new Date().toISOString();
    const records = nodes.map((node) => this.graphStore.upsertProjectionRecord({
      id: `best-skill:${projectLabel}:${node.id}`,
      nodeId: node.id,
      target: ProjectionTarget.BEST_SKILL_ARTIFACT,
      targetRef: `${projectLabel}:best_skill.md`,
      version: Date.now(),
    }));

    return {
      markdown: renderBestSkillMarkdown(projectLabel, generatedAt, nodes),
      records,
      sourceNodeIds: nodes.map((node) => node.id),
    };
  }

  private loadSkillNodes(options: BestSkillProjectionOptions): ContextNode[] {
    return this.graphStore.listNodes({
      project: options.project,
      substrateType: SubstrateType.SKILL,
      limit: options.limit ?? 20,
    })
      .filter((node) => [ContextNodeStatus.ACTIVE, ContextNodeStatus.VERIFIED].includes(node.status))
      .filter((node) => node.confidence >= 0.7 && node.qualityScore >= 70)
      .sort((a, b) => b.qualityScore - a.qualityScore || b.confidence - a.confidence);
  }
}

const renderBestSkillMarkdown = (
  projectLabel: string,
  generatedAt: string,
  nodes: ContextNode[],
): string => [
  `# Best Skill: ${projectLabel}`,
  '',
  `Generated: ${generatedAt}`,
  'Source: Mindstrate ECS graph',
  '',
  ...nodes.flatMap((node, index) => [
    `## Skill ${index + 1}: ${node.title}`,
    '',
    node.content,
    '',
    'Evidence:',
    `- sourceNodeId: ${node.id}`,
    `- qualityScore: ${node.qualityScore}`,
    `- confidence: ${node.confidence}`,
    '',
  ]),
].join('\n').trimEnd();
