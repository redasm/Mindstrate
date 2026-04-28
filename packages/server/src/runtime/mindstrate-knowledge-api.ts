import type {
  AddKnowledgeResult,
  CreateKnowledgeInput,
} from '@mindstrate/protocol';
import { ContextEventType, type ContextNode } from '@mindstrate/protocol/models';
import { toGraphKnowledgeView } from '../context-graph/knowledge-projector.js';
import { digestKnowledgeInput } from '../context-graph/knowledge-digest.js';
import {
  getStringMetadata,
  knowledgeTypeToContextDomain,
} from '../mindstrate-graph-helpers.js';
import type { MindstrateRuntime } from './mindstrate-runtime.js';

export class MindstrateKnowledgeApi {
  constructor(
    private readonly services: MindstrateRuntime,
    private readonly ensureInit: () => Promise<void>,
  ) {}

  async add(input: CreateKnowledgeInput): Promise<AddKnowledgeResult> {
    await this.ensureInit();
    const gateResult = this.services.qualityGate.check(input);
    if (!gateResult.passed) {
      return {
        success: false,
        message: `Quality gate failed: ${gateResult.errors.join('; ')}`,
        qualityWarnings: gateResult.warnings,
      };
    }

    const exactDuplicate = this.findExactGraphDuplicate(input);
    if (exactDuplicate) {
      return {
        success: false,
        message: `Exact duplicate detected. Existing knowledge ID: ${exactDuplicate.id}`,
        duplicateOf: exactDuplicate.id,
      };
    }

    const digested = digestKnowledgeInput(input, {
      completenessScore: gateResult.completenessScore,
    });
    const text = `${digested.nodeInput.title}\n${digested.nodeInput.content}`;
    const embedding = await this.services.embedder.embed(text);
    const duplicates = await this.services.vectorStore.findDuplicates(
      embedding,
      this.services.config.deduplicationThreshold,
    );
    if (duplicates.length > 0) {
      const duplicate = duplicates[0];
      return {
        success: false,
        message: `Duplicate detected (similarity: ${(duplicate.score * 100).toFixed(1)}%). Existing knowledge ID: ${duplicate.id}`,
        duplicateOf: duplicate.id,
      };
    }

    const node = this.services.contextGraphStore.createNode(digested.nodeInput);
    this.services.contextGraphStore.createEvent({
      type: ContextEventType.KNOWLEDGE_WRITE,
      project: node.project,
      actor: input.author,
      content: `${node.title}\n${node.content}`,
      metadata: {
        nodeId: node.id,
        domainType: node.domainType,
        substrateType: node.substrateType,
      },
    });
    await this.services.vectorStore.add({
      id: node.id,
      embedding,
      text,
      metadata: this.vectorMetadata(node),
    });
    this.services.projectionMaterializer.materialize({ project: node.project, limit: 50 });

    return {
      success: true,
      view: toGraphKnowledgeView(node),
      message: `Context node added successfully: ${node.title}`,
      qualityWarnings: gateResult.warnings.length > 0 ? gateResult.warnings : undefined,
    };
  }

  checkQuality(input: CreateKnowledgeInput) {
    return this.services.qualityGate.check(input);
  }

  private vectorMetadata(node: ContextNode): Record<string, string> {
    return {
      type: node.domainType,
      language: getStringMetadata(node, 'context', 'language'),
      framework: getStringMetadata(node, 'context', 'framework'),
      project: node.project ?? '',
    };
  }

  private findExactGraphDuplicate(input: CreateKnowledgeInput): ContextNode | null {
    const title = input.title.trim();
    const content = input.solution.trim();
    const candidates = this.services.contextGraphStore.listNodes({
      project: input.context?.project,
      domainType: knowledgeTypeToContextDomain(input.type),
      limit: 500,
    });
    return candidates.find((node) =>
      node.title === title &&
      node.content === content &&
      getStringMetadata(node, 'context', 'language') === (input.context?.language ?? '') &&
      getStringMetadata(node, 'context', 'framework') === (input.context?.framework ?? '')
    ) ?? null;
  }
}
