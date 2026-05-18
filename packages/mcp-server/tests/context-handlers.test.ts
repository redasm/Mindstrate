/**
 * Regression tests for the context-graph MCP handlers.
 *
 * Focused on the breakages observed via real MCP traffic:
 *   - `context_query_graph` used to drop everything when the caller
 *     passed the uppercase enum member name (`substrateType: "RULE"`)
 *     because the SQLite filter compares against the lowercase value.
 *   - `context_assemble` used to silently omit the
 *     `Project Graph Relationships` / `Retrieval Tickets` sections when
 *     no data surfaced, leaving the AI no way to tell the feature from
 *     a broken pipeline.
 */

import { describe, expect, it } from 'vitest';
import {
  ContextDomainType,
  ContextEventType,
  ContextNodeStatus,
  ProjectGraphNodeKind,
  SubstrateType,
  type AssembledContext,
} from '@mindstrate/protocol';
import {
  handleContextAssemble,
  handleContextIngestEvent,
  handleContextQueryGraph,
} from '../src/tools/context-handlers.js';
import { createFakeMcpApi, systemPageRule } from './fake-mcp-api.js';

describe('handleContextQueryGraph (BUG #1: enum coercion)', () => {
  it('normalizes the uppercase enum member name into the canonical lowercase value', async () => {
    const api = createFakeMcpApi({ contextNodes: [] });

    await handleContextQueryGraph(api, {
      substrateType: 'RULE',
      domainType: 'ARCHITECTURE',
      status: 'VERIFIED',
    });

    const call = api.calls.find((entry) => entry.method === 'queryContextGraph');
    expect(call?.args[0]).toMatchObject({
      substrateType: SubstrateType.RULE,
      domainType: ContextDomainType.ARCHITECTURE,
      status: ContextNodeStatus.VERIFIED,
    });
  });

  it('forwards already-canonical lowercase values unchanged', async () => {
    const api = createFakeMcpApi({ contextNodes: [] });

    await handleContextQueryGraph(api, {
      substrateType: 'rule',
      domainType: 'architecture',
      status: 'verified',
    });

    const call = api.calls.find((entry) => entry.method === 'queryContextGraph');
    expect(call?.args[0]).toMatchObject({
      substrateType: 'rule',
      domainType: 'architecture',
      status: 'verified',
    });
  });
});

describe('handleContextIngestEvent (BUG #1: enum coercion)', () => {
  it('coerces uppercase event/domain/substrate types before passing to ingest', async () => {
    let captured: { type?: ContextEventType; domainType?: ContextDomainType; substrateType?: string } = {};
    const api = createFakeMcpApi({});
    api.ingestContextEvent = async (input) => {
      captured = input;
      return { eventId: 'evt-1', nodeId: 'node-1' };
    };

    await handleContextIngestEvent(api, {
      type: 'TEST_RESULT',
      domainType: 'ARCHITECTURE',
      substrateType: 'RULE',
      content: 'sample',
    });

    expect(captured.type).toBe(ContextEventType.TEST_RESULT);
    expect(captured.domainType).toBe(ContextDomainType.ARCHITECTURE);
    expect(captured.substrateType).toBe(SubstrateType.RULE);
  });
});

describe('handleContextAssemble (BUG #4: explicit diagnostics)', () => {
  const baseAssembled = (overrides: Partial<AssembledContext> = {}): AssembledContext => ({
    summary: '## Working Context for: review code',
    knowledge: [],
    workflows: [],
    warnings: [],
    graphRules: [],
    graphPatterns: [],
    graphSummaries: [],
    graphConflicts: [],
    projectGraphContext: [],
    retrievals: [],
    ...overrides,
  });

  it('emits an explicit Project Graph Relationships section explaining why no facts were surfaced when `project` is missing', async () => {
    const api = createFakeMcpApi({});
    api.assembleContext = async () => baseAssembled();

    const response = await handleContextAssemble(api, { task: 'review code' });

    expect(response.content[0].text).toContain('### Project Graph Relationships');
    expect(response.content[0].text).toContain('no `project` argument was supplied');
    expect(response.content[0].text).toContain('no `currentFile` seed was supplied');
  });

  it('explains the "no architecture nodes matched" cause when both project and currentFile are supplied', async () => {
    const api = createFakeMcpApi({});
    api.assembleContext = async () => baseAssembled();

    const response = await handleContextAssemble(api, {
      task: 'review code',
      project: 'demo',
      currentFile: 'src/App.tsx',
    });

    expect(response.content[0].text).toContain('### Project Graph Relationships');
    expect(response.content[0].text).toContain('mindstrate graph sync');
  });

  it('renders the relationship section when facts do exist and never drops it silently', async () => {
    const api = createFakeMcpApi({});
    api.assembleContext = async () => baseAssembled({
      projectGraphContext: [{
        nodeId: 'pg:demo:file:src/App.tsx',
        label: 'src/App.tsx',
        kind: ProjectGraphNodeKind.FILE,
        source: 'seed',
        evidence: ['src/App.tsx'],
      }],
    });

    const response = await handleContextAssemble(api, {
      task: 'edit App.tsx',
      project: 'demo',
      currentFile: 'src/App.tsx',
    });

    expect(response.content[0].text).toContain('### Project Graph Relationships');
    expect(response.content[0].text).toContain('pg:demo:file:src/App.tsx');
    expect(response.content[0].text).not.toContain('No project graph facts were surfaced');
  });

  it('always emits the Retrieval Tickets header, even when no tickets were minted, so the AI can tell the feature ran', async () => {
    const api = createFakeMcpApi({});
    api.assembleContext = async () => baseAssembled();

    const response = await handleContextAssemble(api, { task: 'review code', project: 'demo' });

    expect(response.content[0].text).toContain('### Retrieval Tickets');
    expect(response.content[0].text).toContain('No retrieval tickets minted');
  });

  it('lists retrieval tickets verbatim when the priority selector picked nodes', async () => {
    const api = createFakeMcpApi({});
    api.assembleContext = async () => baseAssembled({
      retrievals: [{ nodeId: 'node-1', retrievalId: 'r-1', origin: 'graph-rule' }],
    });

    const response = await handleContextAssemble(api, { task: 'review code', project: 'demo' });

    expect(response.content[0].text).toContain('retrievalId: r-1');
    expect(response.content[0].text).toContain('memory_feedback_auto');
  });

  it('surfaces feedback counters inline with each retrieval ticket when the node has non-zero history', async () => {
    // Previously, the agent had no way to tell whether its earlier
    // memory_feedback_auto calls had taken effect — counters lived
    // exclusively in the SQLite row and were never surfaced. Now the
    // ticket line carries `+N / -M` so the loop is observable.
    const api = createFakeMcpApi({});
    api.assembleContext = async () => baseAssembled({
      retrievals: [
        { nodeId: 'rule-1', retrievalId: 'r-rule', origin: 'graph-rule', feedback: { positive: 3, negative: 1 } },
        { nodeId: 'rule-2', retrievalId: 'r-fresh', origin: 'graph-rule', feedback: { positive: 0, negative: 0 } },
      ],
    });

    const response = await handleContextAssemble(api, { task: 'review code', project: 'demo' });

    expect(response.content[0].text).toContain('rule-1');
    expect(response.content[0].text).toContain('feedback so far: +3 / -1');
    // Brand-new node with 0/0 should NOT have the hint (no signal yet).
    expect(response.content[0].text).not.toMatch(/rule-2.*feedback so far/s);
  });

  // Smoke test for the unused-fixture import keeping the regression suite
  // documenting the dependency on system-page rules even though this
  // file does not exercise the project graph branch directly.
  it('imports the system-page rule fixture for cross-suite reuse', () => {
    const rule = systemPageRule({ pageKey: '00-overview' });
    expect(rule.id).toContain('architecture:system-page:');
  });
});
