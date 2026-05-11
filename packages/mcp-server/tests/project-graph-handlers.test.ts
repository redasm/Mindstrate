/**
 * Regression tests for the MCP project graph handlers.
 *
 * Each handler is exercised through a `FakeMcpApi` that returns
 * deterministic fixtures. The tests focus on:
 *   - sub-domain method dispatch (the right `McpApi.*` is called with the
 *     right arguments),
 *   - the happy-path Markdown response, and
 *   - the documented error / empty branches (`isError: true`,
 *     "node not found", "no path found", ...).
 *
 * They intentionally do not assert exact Markdown layouts beyond a few
 * stable substrings — the formatters live in `project-graph-render.ts`
 * and are reshaped frequently.
 */

import { describe, expect, it } from 'vitest';
import { ContextDomainType, ProjectGraphEdgeKind, ProjectGraphNodeKind, ProjectGraphOverlayKind, ProjectGraphOverlaySource } from '@mindstrate/protocol';
import {
  handleProjectGraphAddOverlay,
  handleProjectGraphBlastRadius,
  handleProjectGraphExplainNode,
  handleProjectGraphGetNeighbors,
  handleProjectGraphGetNode,
  handleProjectGraphPath,
  handleProjectGraphQuery,
  handleProjectGraphTaskQuery,
} from '../src/tools/project-graph-handlers.js';
import {
  createFakeMcpApi,
  projectGraphEdge,
  projectGraphNode,
  systemPageRule,
} from './fake-mcp-api.js';

describe('handleProjectGraphQuery', () => {
  it('renders matching nodes and forwards filters to queryContextGraph', async () => {
    const api = createFakeMcpApi({
      contextNodes: [
        projectGraphNode({ id: 'pg:demo:file:src/App.tsx', title: 'src/App.tsx', evidencePaths: ['src/App.tsx'] }),
      ],
    });

    const response = await handleProjectGraphQuery(api, { query: 'App', project: 'demo', limit: 5 });

    const queryCall = api.calls.find((call) => call.method === 'queryContextGraph');
    expect(queryCall?.args[0]).toMatchObject({
      query: 'App',
      project: 'demo',
      domainType: ContextDomainType.ARCHITECTURE,
      limit: 5,
    });
    expect(response.isError).toBeUndefined();
    expect(response.content[0].text).toContain('Found 1 project graph node');
    expect(response.content[0].text).toContain('src/App.tsx');
  });

  it('returns the empty-branch text without an error flag when no nodes match', async () => {
    const api = createFakeMcpApi({ contextNodes: [] });

    const response = await handleProjectGraphQuery(api, { query: 'nope' });

    expect(response.isError).toBeUndefined();
    expect(response.content[0].text).toBe('No project graph nodes matched the query.');
  });
});

describe('handleProjectGraphTaskQuery', () => {
  it('builds a before-edit report and reads overlays for impact / before-edit tasks', async () => {
    const node = projectGraphNode({ id: 'pg:demo:file:src/App.tsx', title: 'src/App.tsx', evidencePaths: ['src/App.tsx'] });
    const api = createFakeMcpApi({ contextNodes: [node], contextEdges: [], overlays: [] });

    const response = await handleProjectGraphTaskQuery(api, { task: 'before-edit', query: 'App' });

    expect(response.content[0].text).toContain('Before Edit Report');
    expect(api.calls.some((call) => call.method === 'listProjectGraphOverlays')).toBe(true);
  });

  it('classifies high-risk target paths even when no graph node matches', async () => {
    const api = createFakeMcpApi({ contextNodes: [], contextEdges: [], overlays: [] });

    const response = await handleProjectGraphTaskQuery(api, { task: 'before-edit', query: 'TypeScript/Typing/UObject.d.ts' });

    expect(response.content[0].text).toContain('Generated outputs are not source of truth');
    expect(response.content[0].text).toContain('TypeScript/Typing');
    expect(response.content[0].text).toContain('Run UnrealSharp/type generation');
  });

  it('emits a generic node listing for non-report tasks', async () => {
    const node = projectGraphNode({ id: 'pg:demo:file:src/App.tsx', title: 'src/App.tsx', evidencePaths: ['src/App.tsx'] });
    const api = createFakeMcpApi({ contextNodes: [node], contextEdges: [] });

    const response = await handleProjectGraphTaskQuery(api, { task: 'entry-points', query: 'App' });

    expect(response.content[0].text).toContain('### entry-points');
    expect(api.calls.some((call) => call.method === 'listProjectGraphOverlays')).toBe(false);
  });
});

describe('handleProjectGraphGetNode', () => {
  it('renders a single node when the lookup matches', async () => {
    const node = projectGraphNode({ id: 'pg:demo:file:src/App.tsx', title: 'src/App.tsx' });
    const api = createFakeMcpApi({ contextNodes: [node] });

    const response = await handleProjectGraphGetNode(api, { id: 'src/App.tsx' });

    expect(response.isError).toBeUndefined();
    expect(response.content[0].text).toContain('src/App.tsx');
  });

  it('returns isError when the node cannot be resolved', async () => {
    const api = createFakeMcpApi({ contextNodes: [] });

    const response = await handleProjectGraphGetNode(api, { id: 'missing' });

    expect(response.isError).toBe(true);
    expect(response.content[0].text).toBe('Project graph node not found.');
  });
});

describe('handleProjectGraphGetNeighbors', () => {
  it('queries outgoing and incoming edges around the resolved node', async () => {
    const node = projectGraphNode({ id: 'pg:demo:file:src/App.tsx', title: 'src/App.tsx' });
    const api = createFakeMcpApi({
      contextNodes: [node],
      contextEdges: [projectGraphEdge({ sourceId: node.id, targetId: 'pg:demo:dependency:react' })],
    });

    const response = await handleProjectGraphGetNeighbors(api, { id: 'src/App.tsx', limit: 5 });

    expect(response.isError).toBeUndefined();
    const edgeCalls = api.calls.filter((call) => call.method === 'listContextEdges');
    expect(edgeCalls.some((call) => (call.args[0] as { sourceId?: string }).sourceId === node.id)).toBe(true);
    expect(edgeCalls.some((call) => (call.args[0] as { targetId?: string }).targetId === node.id)).toBe(true);
  });

  it('returns isError when the node cannot be resolved', async () => {
    const api = createFakeMcpApi({ contextNodes: [] });

    const response = await handleProjectGraphGetNeighbors(api, { id: 'missing' });

    expect(response.isError).toBe(true);
  });
});

describe('handleProjectGraphExplainNode', () => {
  it('summarises the node, its edges, and its overlays', async () => {
    const node = projectGraphNode({ id: 'pg:demo:file:src/App.tsx', title: 'src/App.tsx' });
    const api = createFakeMcpApi({
      contextNodes: [node],
      contextEdges: [projectGraphEdge({ sourceId: node.id, targetId: 'pg:demo:dependency:react' })],
      overlays: [{
        id: 'overlay:1',
        project: 'demo',
        targetNodeId: node.id,
        kind: ProjectGraphOverlayKind.CONVENTION,
        content: 'Edit App.tsx with care.',
        author: 'tester',
        source: ProjectGraphOverlaySource.MCP,
        createdAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-01T00:00:00.000Z',
      }],
    });

    const response = await handleProjectGraphExplainNode(api, { id: 'src/App.tsx' });

    expect(response.content[0].text).toContain('### src/App.tsx');
    expect(response.content[0].text).toContain('Edit App.tsx with care.');
  });

  it('returns isError when the node is missing', async () => {
    const api = createFakeMcpApi({ contextNodes: [] });

    const response = await handleProjectGraphExplainNode(api, { id: 'missing' });

    expect(response.isError).toBe(true);
  });
});

describe('handleProjectGraphPath', () => {
  it('finds a path between two project graph nodes', async () => {
    const a = projectGraphNode({ id: 'pg:demo:file:a.ts', title: 'a.ts' });
    const b = projectGraphNode({ id: 'pg:demo:file:b.ts', title: 'b.ts' });
    const api = createFakeMcpApi({
      contextNodes: [a, b],
      contextEdges: [projectGraphEdge({ sourceId: a.id, targetId: b.id, kind: ProjectGraphEdgeKind.IMPORTS })],
    });

    const response = await handleProjectGraphPath(api, { from: 'a.ts', to: 'b.ts' });

    expect(response.content[0].text).toContain('Found project graph path with 2 node');
    expect(response.content[0].text).toContain('a.ts');
    expect(response.content[0].text).toContain('b.ts');
  });

  it('reports the empty branch when no path exists', async () => {
    const a = projectGraphNode({ id: 'pg:demo:file:a.ts', title: 'a.ts' });
    const b = projectGraphNode({ id: 'pg:demo:file:b.ts', title: 'b.ts' });
    const api = createFakeMcpApi({ contextNodes: [a, b], contextEdges: [] });

    const response = await handleProjectGraphPath(api, { from: 'a.ts', to: 'b.ts' });

    expect(response.isError).toBeUndefined();
    expect(response.content[0].text).toBe('No project graph path found.');
  });
});

describe('handleProjectGraphBlastRadius', () => {
  it('lists affected nodes around the root', async () => {
    const root = projectGraphNode({ id: 'pg:demo:file:root.ts', title: 'root.ts' });
    const dependent = projectGraphNode({ id: 'pg:demo:file:dependent.ts', title: 'dependent.ts' });
    const api = createFakeMcpApi({
      contextNodes: [root, dependent],
      contextEdges: [projectGraphEdge({ sourceId: dependent.id, targetId: root.id, kind: ProjectGraphEdgeKind.DEPENDS_ON })],
    });

    const response = await handleProjectGraphBlastRadius(api, { id: 'root.ts', depth: 1, limit: 5 });

    expect(response.content[0].text).toContain('Blast Radius: root.ts');
    expect(response.content[0].text).toContain('dependent.ts');
  });

  it('returns isError when the root cannot be resolved', async () => {
    const api = createFakeMcpApi({ contextNodes: [] });

    const response = await handleProjectGraphBlastRadius(api, { id: 'missing' });

    expect(response.isError).toBe(true);
  });
});

describe('handleProjectGraphAddOverlay', () => {
  it('forwards the overlay payload and renders the created overlay summary', async () => {
    const overlay = {
      id: 'overlay:created',
      project: 'demo',
      targetNodeId: 'pg:demo:file:src/App.tsx',
      kind: ProjectGraphOverlayKind.CONVENTION,
      content: 'Use the assembly API.',
      author: 'tester',
      source: ProjectGraphOverlaySource.MCP,
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
    };
    const api = createFakeMcpApi({ createOverlay: () => overlay });

    const response = await handleProjectGraphAddOverlay(api, {
      project: 'demo',
      targetNodeId: 'pg:demo:file:src/App.tsx',
      kind: ProjectGraphOverlayKind.CONVENTION,
      content: 'Use the assembly API.',
      author: 'tester',
    });

    const createCall = api.calls.find((call) => call.method === 'createProjectGraphOverlay');
    expect(createCall?.args[0]).toMatchObject({
      project: 'demo',
      targetNodeId: 'pg:demo:file:src/App.tsx',
      kind: ProjectGraphOverlayKind.CONVENTION,
      content: 'Use the assembly API.',
      author: 'tester',
      source: ProjectGraphOverlaySource.MCP,
    });
    expect(response.content[0].text).toContain('Project graph overlay added.');
    expect(response.content[0].text).toContain('overlay:created');
  });
});

describe('handleProjectGraphTaskQuery system-page metadata integration', () => {
  it('surfaces project-specific Known Constraints when a system-page rule matches the classification', async () => {
    // Build a node whose evidence carries the Unreal reflection extractor
    // marker, so `classifyTargets` adds 'native-script-binding'.
    const node = projectGraphNode({
      id: 'pg:demo:file:Source/MixedBindings/Public/Inventory.h',
      title: 'Source/MixedBindings/Public/Inventory.h',
      kind: ProjectGraphNodeKind.CLASS,
      evidencePaths: ['Source/MixedBindings/Public/Inventory.h'],
    });
    // Inject the reflection evidence record the classifier looks for.
    node.metadata = {
      ...node.metadata,
      evidence: [{ path: 'Source/MixedBindings/Public/Inventory.h', extractorId: 'unreal-cpp-reflection' }],
    };
    const api = createFakeMcpApi({
      contextNodes: [node],
      contextEdges: [],
      overlays: [],
      systemPageRules: [systemPageRule({
        pageKey: '02-cpp-typescript-bridge',
        classifications: ['native-script-binding', 'generated-output', 'typescript-consumer'],
        knownConstraints: [
          'Generated TypeScript declarations must be driven by C++ reflection metadata or generator configuration.',
        ],
        doNotEditTargets: ['TypeScript/Typing'],
        affectedChain: 'C++ UCLASS -> UHT -> UnrealSharp generator -> TypeScript/Typing -> consumers.',
        recommendedVerification: ['Run UnrealSharp/type generation and inspect generated declarations.'],
      })],
    });

    const response = await handleProjectGraphTaskQuery(api, { task: 'before-edit', query: 'Inventory.h' });

    const text = response.content[0].text;
    expect(text).toContain('### Known Constraints');
    expect(text).toContain('Generated TypeScript declarations must be driven by C++ reflection metadata');
    expect(text).toContain('### Do Not Edit Directly');
    expect(text).toContain('TypeScript/Typing');
    expect(text).toContain('### Affected Chains');
    expect(text).toContain('C++ UCLASS -> UHT -> UnrealSharp generator -> TypeScript/Typing -> consumers.');
    expect(text).toContain('### Recommended Verification');
    expect(text).toContain('Run UnrealSharp/type generation');
  });

  it('falls back to generic constraints when no system-page rule matches the classification', async () => {
    const node = projectGraphNode({
      id: 'pg:demo:file:src/random.ts',
      title: 'src/random.ts',
      evidencePaths: ['src/random.ts'],
    });
    const api = createFakeMcpApi({
      contextNodes: [node],
      contextEdges: [],
      overlays: [],
      systemPageRules: [systemPageRule({
        pageKey: '03-plugin-boundaries',
        classifications: ['build-module', 'plugin-manifest'],
        knownConstraints: ['Project-specific plugin rule.'],
      })],
    });

    const response = await handleProjectGraphTaskQuery(api, { task: 'before-edit', query: 'random.ts' });

    const text = response.content[0].text;
    // The classification picked up 'typescript-consumer' from the .ts
    // suffix, which the supplied system-page does not cover, so its
    // project-specific constraint must NOT appear.
    expect(text).not.toContain('Project-specific plugin rule.');
  });

  it('still applies a global system-page (no classifications) for recommendedVerification', async () => {
    const node = projectGraphNode({
      id: 'pg:demo:file:src/random.ts',
      title: 'src/random.ts',
      evidencePaths: ['src/random.ts'],
    });
    const api = createFakeMcpApi({
      contextNodes: [node],
      contextEdges: [],
      overlays: [],
      systemPageRules: [systemPageRule({
        pageKey: '05-validation-playbook',
        // intentionally no classifications -> a global page
        recommendedVerification: ['Select validation commands from the affected chain.'],
      })],
    });

    const response = await handleProjectGraphTaskQuery(api, { task: 'before-edit', query: 'random.ts' });

    expect(response.content[0].text).toContain('Select validation commands from the affected chain.');
  });
});
