import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  ContextDomainType,
  ContextNodeStatus,
  ProjectGraphNodeKind,
  ProjectGraphProvenance,
  SubstrateType,
  type ContextNode,
} from '@mindstrate/protocol/models';
import { ContextGraphStore } from '../src/context-graph/context-graph-store.js';
import { Mindstrate } from '../src/mindstrate.js';
import { enrichProjectGraph, summarizeProjectGraphWithLlm } from '../src/project-graph/enrichment.js';
import type { OpenAIClient } from '../src/openai-client.js';
import { createTempDir, removeTempDir } from './test-support.js';

describe('project graph LLM enrichment boundary', () => {
  let tempDir: string;
  let store: ContextGraphStore;

  beforeEach(() => {
    tempDir = createTempDir('mindstrate-project-graph-enrichment-');
    store = new ContextGraphStore(path.join(tempDir, 'context-graph.db'));
  });

  afterEach(() => {
    store.close();
    removeTempDir(tempDir);
  });

  it('skips enrichment when no LLM provider is configured', async () => {
    const result = await enrichProjectGraph(store, {
      project: 'demo',
      llmConfigured: false,
    });

    expect(result).toEqual({ status: 'skipped', reason: 'llm_not_configured', nodesCreated: 0 });
    expect(store.listNodes({ project: 'demo', limit: 10 })).toHaveLength(0);
  });

  it('writes only evidence-backed inferred nodes from enrichment output', async () => {
    const result = await enrichProjectGraph(store, {
      project: 'demo',
      llmConfigured: true,
      summarize: async () => [
        {
          id: 'pg:demo:concept:auth-flow',
          kind: ProjectGraphNodeKind.CONCEPT,
          label: 'Auth flow',
          project: 'demo',
          provenance: ProjectGraphProvenance.INFERRED,
          evidence: [{ path: 'src/auth/session.ts', extractorId: 'llm-enrichment' }],
        },
        {
          id: 'pg:demo:concept:uncited',
          kind: ProjectGraphNodeKind.CONCEPT,
          label: 'Uncited',
          project: 'demo',
          provenance: ProjectGraphProvenance.INFERRED,
          evidence: [],
        },
      ],
    });

    const nodes = store.listNodes({ project: 'demo', limit: 10 });
    expect(result.status).toBe('enriched');
    expect(result.nodesCreated).toBe(1);
    expect(nodes).toHaveLength(1);
    expect(nodes[0].metadata?.['provenance']).toBe(ProjectGraphProvenance.INFERRED);
    expect(nodes[0].metadata?.['evidence']).toEqual([
      { path: 'src/auth/session.ts', extractorId: 'llm-enrichment' },
    ]);
  });

  it('returns noop when LLM enrichment has no acceptable nodes', async () => {
    const result = await enrichProjectGraph(store, {
      project: 'demo',
      llmConfigured: true,
      summarize: async () => [],
    });

    expect(result).toEqual({ status: 'noop', nodesCreated: 0, nodesUpdated: 0 });
  });

  it('skips repeated LLM enrichment for unchanged extracted facts', async () => {
    let calls = 0;
    const result1 = await enrichProjectGraph(store, {
      project: 'demo',
      llmConfigured: true,
      extractedNodes: [projectGraphNode('src/App.tsx')],
      summarize: async () => {
        calls++;
        return [{
          id: 'pg:demo:concept:app-shell',
          kind: ProjectGraphNodeKind.CONCEPT,
          label: 'App shell',
          project: 'demo',
          provenance: ProjectGraphProvenance.INFERRED,
          evidence: [{ path: 'src/App.tsx', extractorId: 'llm-enrichment' }],
        }];
      },
    });
    const result2 = await enrichProjectGraph(store, {
      project: 'demo',
      llmConfigured: true,
      extractedNodes: [projectGraphNode('src/App.tsx')],
      summarize: async () => {
        calls++;
        return [];
      },
    });

    expect(result1.status).toBe('enriched');
    expect(result2).toEqual({ status: 'noop', reason: 'unchanged_input', nodesCreated: 0, nodesUpdated: 0 });
    expect(calls).toBe(1);
  });

  it('exposes provider-aware enrichment through the context API', async () => {
    const memory = new Mindstrate({ dataDir: tempDir, openaiApiKey: 'test-key' });
    await memory.init();
    try {
      memory.context.createContextNode({
        id: 'pg:demo:file:src/App.tsx',
        substrateType: SubstrateType.SNAPSHOT,
        domainType: ContextDomainType.ARCHITECTURE,
        title: 'src/App.tsx',
        content: 'file: src/App.tsx',
        project: 'demo',
        status: ContextNodeStatus.ACTIVE,
        metadata: {
          projectGraph: true,
          kind: ProjectGraphNodeKind.FILE,
          provenance: ProjectGraphProvenance.EXTRACTED,
          evidence: [{ path: 'src/App.tsx', extractorId: 'project-graph-scanner' }],
        },
      });

      const result = await memory.context.enrichProjectGraph({
        name: 'demo',
        root: tempDir,
        dependencies: [],
        entryPoints: [],
      } as never, {
        summarize: async () => [
          {
            id: 'pg:demo:concept:app-shell',
            kind: ProjectGraphNodeKind.CONCEPT,
            label: 'App shell',
            project: 'demo',
            provenance: ProjectGraphProvenance.INFERRED,
            evidence: [{ path: 'src/App.tsx', extractorId: 'llm-enrichment' }],
          },
        ],
      });

      expect(result.status).toBe('enriched');
      expect(memory.context.listContextNodes({ project: 'demo', limit: 10 })
        .some((node) => node.id === 'pg:demo:concept:app-shell')).toBe(true);
    } finally {
      memory.close();
    }
  });

  it('skips context API enrichment when no provider is configured', async () => {
    const memory = new Mindstrate({ dataDir: tempDir, openaiApiKey: '' });
    await memory.init();
    try {
      const result = await memory.context.enrichProjectGraph({
        name: 'demo',
        root: tempDir,
        dependencies: [],
        entryPoints: [],
      } as never);

      expect(result).toEqual({ status: 'skipped', reason: 'llm_not_configured', nodesCreated: 0 });
    } finally {
      memory.close();
    }
  });

  it('turns LLM summaries into cited inferred project graph nodes', async () => {
    const client = fakeChatClient(JSON.stringify({
      summaries: [
        {
          label: 'Application shell',
          summary: 'The application shell starts in App.tsx and composes the home route.',
          evidencePaths: ['src/App.tsx'],
          confidence: 'inferred',
        },
        {
          label: 'Uncited guess',
          summary: 'This should be filtered.',
          evidencePaths: [],
          confidence: 'inferred',
        },
      ],
    }));

    const nodes = await summarizeProjectGraphWithLlm({
      client,
      model: 'test-model',
      project: 'demo',
      extractedNodes: [{
        id: 'pg:demo:file:src/App.tsx',
        substrateType: SubstrateType.SNAPSHOT,
        domainType: ContextDomainType.ARCHITECTURE,
        title: 'src/App.tsx',
        content: 'file: src/App.tsx',
        tags: ['project-graph', 'file'],
        project: 'demo',
        compressionLevel: 1,
        confidence: 1,
        qualityScore: 80,
        positiveFeedback: 0,
        negativeFeedback: 0,
        status: ContextNodeStatus.ACTIVE,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
        sourceRef: 'src/App.tsx',
        metadata: {
          projectGraph: true,
          kind: ProjectGraphNodeKind.FILE,
          provenance: ProjectGraphProvenance.EXTRACTED,
          evidence: [{ path: 'src/App.tsx', extractorId: 'project-graph-scanner' }],
        },
      }],
    });

    expect(nodes).toHaveLength(1);
    expect(nodes[0]).toMatchObject({
      kind: ProjectGraphNodeKind.CONCEPT,
      label: 'Application shell',
      project: 'demo',
      provenance: ProjectGraphProvenance.INFERRED,
      evidence: [{ path: 'src/App.tsx', extractorId: 'llm-enrichment' }],
      metadata: {
        summary: 'The application shell starts in App.tsx and composes the home route.',
      },
    });
  });

  it('sends salient extracted facts to the LLM before applying the cap', async () => {
    let payload = '';
    const client = fakeChatClient(JSON.stringify({ summaries: [] }), (content) => {
      payload = content;
    });

    await summarizeProjectGraphWithLlm({
      client,
      model: 'test-model',
      project: 'demo',
      extractedNodes: [
        ...Array.from({ length: 80 }, (_, index) => projectGraphNode(`src/low-${index}.ts`, { accessCount: 0 })),
        projectGraphNode('src/App.tsx', { accessCount: 10, positiveFeedback: 5 }),
      ],
    });

    const parsed = JSON.parse(payload) as { extractedFacts: Array<{ title: string }> };
    const titles = parsed.extractedFacts.map((fact) => fact.title);
    expect(titles).toHaveLength(80);
    expect(titles).toContain('src/App.tsx');
    expect(titles.filter((title) => title.startsWith('src/low-'))).toHaveLength(79);
  });
});

const projectGraphNode = (
  filePath: string,
  overrides: Partial<Pick<ContextNode, 'accessCount' | 'positiveFeedback'>> = {},
): ContextNode => ({
  id: `pg:demo:file:${filePath}`,
  substrateType: SubstrateType.SNAPSHOT,
  domainType: ContextDomainType.ARCHITECTURE,
  title: filePath,
  content: `file: ${filePath}`,
  tags: ['project-graph', 'file'],
  project: 'demo',
  compressionLevel: 1,
  confidence: 1,
  qualityScore: 80,
  positiveFeedback: overrides.positiveFeedback ?? 0,
  negativeFeedback: 0,
  accessCount: overrides.accessCount ?? 0,
  status: ContextNodeStatus.ACTIVE,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  sourceRef: filePath,
  metadata: {
    projectGraph: true,
    kind: ProjectGraphNodeKind.FILE,
    provenance: ProjectGraphProvenance.EXTRACTED,
    evidence: [{ path: filePath, extractorId: 'project-graph-scanner' }],
  },
});

const fakeChatClient = (content: string, onUserContent?: (content: string) => void): OpenAIClient => ({
  embeddings: {
    create: async () => ({ data: [] }),
  },
  chat: {
    completions: {
      create: async (input) => {
        const user = input.messages.find((message) => message.role === 'user');
        if (typeof user?.content === 'string') onUserContent?.(user.content);
        return {
          choices: [{ message: { content } }],
        };
      },
    },
  },
});
