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

    // The path lives under a generated root, so the classifier still
    // tags it `generated-output` and the safety pass flags the edit.
    // The previous Unreal-flavored fallbacks ("Run UnrealSharp/type
    // generation") are no longer hardcoded into the report — they only
    // surface when a project's system-page rule actually contributes
    // them via metadata.
    expect(response.content[0].text).toContain('Generated outputs are not source of truth');
    expect(response.content[0].text).toContain('TypeScript/Typing');
    expect(response.content[0].text).toContain('generated-output-targeted');
    expect(response.content[0].text).not.toContain('Run UnrealSharp/type generation');
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

  // BUG #2 regression: the canonical `architecture:system-page:<project>:
  // <key>` RULE node produced by `internalize-system-pages.ts` used to be
  // unreachable via `get_project_graph_node` because the lookup pre-filtered
  // through `projectGraphNodes` (which drops anything without
  // `metadata.projectGraph === true`). The handler now falls back to the
  // system-page RULE branch so callers can resolve those node ids directly.
  it('resolves an architecture system-page RULE node by its canonical id', async () => {
    const rule = systemPageRule({
      pageKey: '00-overview',
      title: 'mindstrate architecture',
      project: 'mindstrate',
    });
    const api = createFakeMcpApi({ systemPageRules: [rule] });

    const response = await handleProjectGraphGetNode(api, {
      id: 'architecture:system-page:mindstrate:00-overview',
      project: 'mindstrate',
    });

    expect(response.isError).toBeUndefined();
    expect(response.content[0].text).toContain('mindstrate architecture');
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

  // BUG #2 regression: explain_project_graph_node must accept the
  // canonical system-page RULE id the same way get_project_graph_node
  // now does. The MCP transcript that surfaced this had the AI ask for
  // `architecture:system-page:mindstrate:02-validation-playbook` and get
  // `Project graph node not found` even though the node existed.
  it('resolves an architecture system-page RULE node by its canonical id', async () => {
    const rule = systemPageRule({
      pageKey: '02-validation-playbook',
      title: 'validation playbook',
      project: 'mindstrate',
    });
    const api = createFakeMcpApi({ systemPageRules: [rule] });

    const response = await handleProjectGraphExplainNode(api, {
      id: 'architecture:system-page:mindstrate:02-validation-playbook',
      project: 'mindstrate',
    });

    expect(response.isError).toBeUndefined();
    expect(response.content[0].text).toContain('validation playbook');
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
    // `random.ts` no longer auto-triggers any stack classification
    // (the previous hardcoded `.ts -> typescript-consumer` mapping was
    // removed, see project-graph-task-report.ts), and the supplied
    // system-page covers `build-module` / `plugin-manifest` instead.
    // It therefore must NOT contribute its project-specific constraint.
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

  it('keeps a plain Node TypeScript project free of UnrealSharp-flavored guidance', async () => {
    // Path 3 invariant: without a stack preset that opts in via
    // `metadata.triggers`, a `.ts` file no longer auto-promotes to
    // `typescript-consumer`. Mindstrate itself relies on this — its
    // before-edit reports must not list UnrealSharp / TypeScript/Typing
    // chains.
    const api = createFakeMcpApi({
      contextNodes: [],
      contextEdges: [],
      overlays: [],
      systemPageRules: [],
    });

    const response = await handleProjectGraphTaskQuery(api, {
      task: 'before-edit',
      query: 'packages/server/src/runtime/mindstrate-runtime.ts',
    });
    const text = response.content[0].text;
    expect(text).not.toContain('UnrealSharp');
    expect(text).not.toContain('TypeScript/Typing');
    expect(text).not.toContain('typescript-consumer');
  });

  it('lights up typescript-consumer ONLY when a system-page rule contributes a matching trigger', async () => {
    // Same path as above, but this time the project ships an Unreal
    // architecture preset whose 02-cpp-typescript-bridge page declares
    // a trigger for `.ts`. The classification must now appear, and the
    // page's project-specific guidance must surface.
    const api = createFakeMcpApi({
      contextNodes: [],
      contextEdges: [],
      overlays: [],
      systemPageRules: [systemPageRule({
        pageKey: '02-cpp-typescript-bridge',
        classifications: ['native-script-binding', 'generated-output', 'typescript-consumer'],
        triggers: { extensions: ['.ts', '.tsx'], pathContains: ['/typescript/typing/'] },
        knownConstraints: ['Generated TypeScript declarations must be driven by C++ reflection metadata.'],
        sourceOfTruth: ['C++ reflection source or UnrealSharp generator/configuration.'],
      })],
    });

    const response = await handleProjectGraphTaskQuery(api, {
      task: 'before-edit',
      query: 'TypeScript/Typing/UObject.d.ts',
    });
    const text = response.content[0].text;
    expect(text).toContain('typescript-consumer');
    expect(text).toContain('Generated TypeScript declarations must be driven by C++ reflection metadata.');
  });

  it('reports a project-specific Source Of Truth from system-page metadata when available', async () => {
    // Reproduces Gap B from the post-rollout review: a query for
    // "TypeScript/Typing" used to receive only the generic fallback
    // ("Exact source file and its direct callers/importers.") even
    // when the cpp-typescript-bridge system page rule was loaded,
    // because `analyzeProjectGraphTask` did not thread system-page
    // `sourceOfTruth` through the merge step. Triggers wire the rule
    // to the actual path so it activates without a hardcoded
    // typescript-consumer mapping in the task report.
    const api = createFakeMcpApi({
      contextNodes: [],
      contextEdges: [],
      overlays: [],
      systemPageRules: [systemPageRule({
        pageKey: '02-cpp-typescript-bridge',
        classifications: ['native-script-binding', 'generated-output', 'typescript-consumer'],
        triggers: { extensions: ['.ts', '.tsx'], pathContains: ['/typescript/typing/'] },
        knownConstraints: ['Generated TypeScript declarations must be driven by C++ reflection metadata.'],
        doNotEditTargets: ['TypeScript/Typing'],
        sourceOfTruth: ['C++ reflection source or UnrealSharp generator/configuration.'],
      })],
    });

    const response = await handleProjectGraphTaskQuery(api, { task: 'before-edit', query: 'TypeScript/Typing' });

    const text = response.content[0].text;
    // The do-not-edit target should be the project-specific one,
    // pulled in through the metadata-merge path before any generic
    // fallback that lists every generated root.
    expect(text).toMatch(/### Do Not Edit Directly[\s\S]*TypeScript\/Typing/);
    // Source Of Truth must include the project-specific sentence,
    // not just the generic "Exact source file ..." fallback.
    expect(text).toContain('C++ reflection source or UnrealSharp generator/configuration.');
  });

  it('returns "Do Not Edit Directly: TypeScript/Typing" for a bare TypeScript/Typing query (Gap A regression)', async () => {
    // Pinned regression: a query of just "TypeScript/Typing" with no
    // selected nodes and no evidence still has to surface the
    // project-specific do-not-edit target. The page declares a trigger
    // (`pathContains: ['/typescript/typing/']` and `extensions: ['.ts']`)
    // that lights up `typescript-consumer` for the matching path. A
    // project that does not load the cpp-typescript-bridge page never
    // sees this entry — that is the Path 3 invariant.
    const api = createFakeMcpApi({
      contextNodes: [],
      contextEdges: [],
      overlays: [],
      systemPageRules: [systemPageRule({
        pageKey: '02-cpp-typescript-bridge',
        classifications: ['native-script-binding', 'generated-output', 'typescript-consumer'],
        triggers: { extensions: ['.ts', '.tsx'], pathContains: ['/typescript/typing/'] },
        doNotEditTargets: ['TypeScript/Typing'],
      })],
    });

    const response = await handleProjectGraphTaskQuery(api, { task: 'before-edit', query: 'TypeScript/Typing' });

    const text = response.content[0].text;
    const doNotEditSection = text.split('### Do Not Edit Directly')[1]?.split('### ')[0] ?? '';
    expect(doNotEditSection).toContain('TypeScript/Typing');
    // Order matters: the project-specific entry must come first so a
    // human/agent reading the report sees it before the generic list
    // of every generated root.
    const lines = doNotEditSection.split('\n').map((line) => line.trim()).filter((line) => line.startsWith('- '));
    expect(lines[0]).toBe('- TypeScript/Typing');
  });
});
