import type { GraphKnowledgeView } from '@mindstrate/protocol';
import { ContextDomainType, ContextEventType, SubstrateType, type ContextNode, type ContextNodeStatus } from '@mindstrate/protocol/models';
import { buildProjectSnapshot, type DetectedProject } from '../project/index.js';
import type { CreateContextNodeInput } from '../context-graph/context-graph-store.js';
import { toGraphKnowledgeView } from '../context-graph/knowledge-projector.js';
import { getStringMetadata } from '../context-graph/context-node-metadata.js';
import type { MindstrateRuntime } from './mindstrate-runtime.js';

export class MindstrateSnapshotApi {
  constructor(
    private readonly services: MindstrateRuntime,
    private readonly ensureInit: () => Promise<void>,
  ) {}

  async upsertProjectSnapshot(
    project: DetectedProject,
    options: { author?: string; trusted?: boolean } = {},
  ): Promise<{ node: ContextNode; view: GraphKnowledgeView; changed: boolean; created: boolean }> {
    await this.ensureInit();

    const { id } = buildProjectSnapshot(project, options);
    const existingNode = this.services.contextGraphStore.getNodeById(id);
    const built = buildProjectSnapshot(project, {
      ...options,
      previousSolution: existingNode?.content,
    });
    const nodeInput = this.createSnapshotNodeInput(id, built, options);
    const created = !existingNode;
    const node = existingNode
      ? this.services.contextGraphStore.updateNode(id, nodeInput)!
      : this.services.contextGraphStore.createNode(nodeInput);

    await this.indexSnapshotNode(node, id);

    if (created || built.changed) {
      this.services.contextGraphStore.createEvent({
        type: ContextEventType.PROJECT_SNAPSHOT,
        project: node.project,
        actor: typeof node.metadata?.['author'] === 'string' ? node.metadata['author'] : undefined,
        content: node.content,
        metadata: { nodeId: node.id },
      });
      this.services.projectSnapshotProjectionMaterializer.materialize({ project: node.project, limit: 10 });
    }

    const view = this.services.graphKnowledgeProjector.project({ project: node.project, limit: 100 })
      .find((entry) => entry.id === node.id);

    return {
      node,
      view: view ?? toGraphKnowledgeView(node),
      changed: built.changed || created,
      created,
    };
  }

  getProjectSnapshot(project: DetectedProject): ContextNode | null {
    const { id } = buildProjectSnapshot(project);
    return this.services.contextGraphStore.getNodeById(id);
  }

  private createSnapshotNodeInput(
    id: string,
    built: ReturnType<typeof buildProjectSnapshot>,
    options: { author?: string; trusted?: boolean },
  ): CreateContextNodeInput {
    return {
      id,
      substrateType: SubstrateType.SNAPSHOT,
      domainType: ContextDomainType.PROJECT_SNAPSHOT,
      title: built.input.title,
      content: built.input.solution,
      tags: built.input.tags,
      project: built.input.context?.project,
      compressionLevel: 0.02,
      confidence: built.input.confidence,
      qualityScore: options.trusted ? 90 : 70,
      status: 'active' as ContextNodeStatus,
      sourceRef: id,
      metadata: {
        problem: built.input.problem,
        actionable: built.input.actionable,
        context: built.input.context,
        author: built.input.author,
        source: built.input.source,
      },
    };
  }

  private async indexSnapshotNode(node: ContextNode, id: string): Promise<void> {
    try {
      const text = `${node.title}\n${node.content}`;
      const embedding = await this.services.embedder.embed(text);
      await this.services.vectorStore.delete(id);
      await this.services.vectorStore.add({
        id,
        embedding,
        text,
        metadata: {
          type: node.domainType,
          language: getStringMetadata(node, 'context', 'language'),
          framework: getStringMetadata(node, 'context', 'framework'),
          project: node.project ?? '',
        },
      });
    } catch (err) {
      console.warn(
        `[Mindstrate] project snapshot embedding failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
}

