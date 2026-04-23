import {
  CaptureSource,
  type CreateKnowledgeInput,
  type KnowledgeUnit,
} from '@mindstrate/protocol';
import { ProjectionTarget, type ProjectionRecord, type ContextNode } from '@mindstrate/protocol/models';
import { Embedder } from '../processing/embedder.js';
import type { IVectorStore } from '../storage/vector-store-interface.js';
import { MetadataStore } from '../storage/metadata-store.js';
import type { ContextGraphStore } from '../context-graph/context-graph-store.js';
import { nodeToKnowledgeType } from '../context-graph/knowledge-digest.js';

export class KnowledgeUnitMaterializer {
  private readonly graphStore: ContextGraphStore;
  private readonly metadataStore: MetadataStore;
  private readonly vectorStore: IVectorStore;
  private readonly embedder: Embedder;

  constructor(
    graphStore: ContextGraphStore,
    metadataStore: MetadataStore,
    vectorStore: IVectorStore,
    embedder: Embedder,
  ) {
    this.graphStore = graphStore;
    this.metadataStore = metadataStore;
    this.vectorStore = vectorStore;
    this.embedder = embedder;
  }

  async materializeNode(node: ContextNode): Promise<{ knowledge: KnowledgeUnit; projection: ProjectionRecord }> {
    const input = this.toKnowledgeInput(node);
    const existing = this.metadataStore.getById(node.id);
    const knowledge = existing
      ? this.metadataStore.update(node.id, {
        title: input.title,
        problem: input.problem,
        solution: input.solution,
        codeSnippets: input.codeSnippets,
        tags: input.tags,
        context: input.context,
        confidence: input.confidence,
        actionable: input.actionable,
      })!
      : this.metadataStore.create(input, { id: node.id });

    const text = this.embedder.knowledgeToText(knowledge);
    const embedding = await this.embedder.embed(text);
    if (existing) {
      await this.vectorStore.update({
        id: knowledge.id,
        embedding,
        text,
        metadata: {
          type: knowledge.type,
          language: knowledge.context.language ?? '',
          framework: knowledge.context.framework ?? '',
          project: knowledge.context.project ?? '',
        },
      });
    } else {
      await this.vectorStore.add({
        id: knowledge.id,
        embedding,
        text,
        metadata: {
          type: knowledge.type,
          language: knowledge.context.language ?? '',
          framework: knowledge.context.framework ?? '',
          project: knowledge.context.project ?? '',
        },
      });
    }

    const projection = this.graphStore.upsertProjectionRecord({
      id: `projection:${ProjectionTarget.KNOWLEDGE_UNIT}:${node.id}`,
      nodeId: node.id,
      target: ProjectionTarget.KNOWLEDGE_UNIT,
      targetRef: knowledge.id,
      version: knowledge.version,
    });

    return { knowledge, projection };
  }

  private toKnowledgeInput(node: ContextNode): CreateKnowledgeInput {
    const metadata = node.metadata ?? {};
    return {
      type: nodeToKnowledgeType(node),
      title: node.title,
      problem: typeof metadata['problem'] === 'string' ? metadata['problem'] : undefined,
      solution: node.content,
      codeSnippets: Array.isArray(metadata['codeSnippets']) ? metadata['codeSnippets'] as CreateKnowledgeInput['codeSnippets'] : undefined,
      tags: node.tags,
      context: typeof metadata['context'] === 'object' && metadata['context'] !== null
        ? metadata['context'] as CreateKnowledgeInput['context']
        : { project: node.project },
      author: typeof metadata['author'] === 'string' ? metadata['author'] : 'ecs-materializer',
      source: typeof metadata['source'] === 'string'
        ? metadata['source'] as CaptureSource
        : CaptureSource.AUTO_DETECT,
      commitHash: typeof metadata['commitHash'] === 'string' ? metadata['commitHash'] : undefined,
      confidence: typeof metadata['confidence'] === 'number' ? metadata['confidence'] : node.confidence,
      actionable: typeof metadata['actionable'] === 'object' && metadata['actionable'] !== null
        ? metadata['actionable'] as CreateKnowledgeInput['actionable']
        : undefined,
    };
  }
}
