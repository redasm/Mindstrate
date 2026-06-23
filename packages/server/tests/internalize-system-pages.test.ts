/**
 * Tests for `internalize-system-pages.ts`.
 *
 * The internalizer is the bridge that turns the locale-specific
 * SystemPageDefinition arrays (Markdown for humans) into ECS RULE nodes
 * (searchable by MCP). Without this bridge `mindstrate_context_assemble`
 * and `mindstrate_search_graph_knowledge` cannot recall any of the
 * project architecture content.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as path from 'node:path';
import {
  ContextDomainType,
  ContextNodeStatus,
  SubstrateType,
} from '@mindstrate/protocol/models';
import { ContextGraphStore } from '../src/context-graph/context-graph-store.js';
import {
  SYSTEM_PAGE_RULE_TAG,
  internalizeSystemPagesAsRules,
  systemPageRuleId,
} from '../src/project-graph/internalize-system-pages.js';
import type { SystemPageDefinition } from '../src/project-graph/obsidian-system-page-types.js';
import { createTempDir, removeTempDir } from './test-support.js';

const PROJECT = 'demo';
const PROJECT_INPUT = { name: PROJECT, root: '/tmp/demo', dependencies: [], entryPoints: [] } as never;

const buildPage = (overrides: Partial<SystemPageDefinition> = {}): SystemPageDefinition => ({
  key: '01-runtime-lifecycle',
  name: '01-runtime-lifecycle.md',
  title: 'Runtime Lifecycle',
  body: ['## Flow', '', '- .uproject defines plugins.'],
  overlays: [],
  userNotesPlaceholder: '- notes',
  userNotesTitle: 'User Notes',
  overlayTitle: 'Structured Overlay',
  metadata: {
    classifications: ['plugin-manifest', 'build-module'],
    knownConstraints: ['Manifests are high impact.'],
    affectedChain: '.uproject -> Build.cs -> runtime/editor.',
    recommendedVerification: ['Validate startup.'],
    tags: ['runtime-lifecycle'],
  },
  ...overrides,
});

let tempDir: string;
let store: ContextGraphStore;

beforeEach(() => {
  tempDir = createTempDir('mindstrate-internalize-system-pages-');
  store = new ContextGraphStore(path.join(tempDir, 'context-graph.db'));
});

afterEach(() => {
  store.close();
  removeTempDir(tempDir);
});

describe('internalizeSystemPagesAsRules', () => {
  it('creates one RULE node per page on first run', () => {
    const pages = [buildPage(), buildPage({ key: '02-bridge', name: '02-bridge.md', title: 'Bridge' })];

    const result = internalizeSystemPagesAsRules(store, PROJECT_INPUT, pages);

    expect(result.pagesProcessed).toBe(2);
    expect(result.created).toHaveLength(2);
    expect(result.updated).toHaveLength(0);
    expect(result.unchanged).toHaveLength(0);
    const node = store.getNodeById(systemPageRuleId(PROJECT, '01-runtime-lifecycle'));
    expect(node).not.toBeNull();
    expect(node?.substrateType).toBe(SubstrateType.RULE);
    expect(node?.domainType).toBe(ContextDomainType.ARCHITECTURE);
    expect(node?.status).toBe(ContextNodeStatus.VERIFIED);
  });

  it('uses a deterministic id keyed by project + page key', () => {
    expect(systemPageRuleId(PROJECT, '01-runtime-lifecycle'))
      .toBe('architecture:system-page:demo:01-runtime-lifecycle');
  });

  it('expands the operation-manual placeholder into the node content', () => {
    const projectWithManual = {
      name: PROJECT,
      root: '/tmp/demo',
      dependencies: [],
      entryPoints: [],
      graphHints: {
        operationManual: {
          architecture: ['NAMI is a TypeScript business layer bridged via PuerTS.'],
        },
      },
    } as never;
    const page = buildPage({
      key: '00-overview',
      name: '00-overview.md',
      title: 'Overview',
      body: ['## Purpose', '', '- Entry point.', '', '<!-- mindstrate:operation-manual -->'],
    });

    internalizeSystemPagesAsRules(store, projectWithManual, [page]);

    const node = store.getNodeById(systemPageRuleId(PROJECT, '00-overview'));
    expect(node).not.toBeNull();
    // The literal placeholder must NOT survive into the knowledge card...
    expect(node?.content).not.toContain('<!-- mindstrate:operation-manual -->');
    // ...and the operation-manual content must be injected instead.
    expect(node?.content).toContain('NAMI is a TypeScript business layer bridged via PuerTS.');
  });

  it('persists structured metadata so task-report can read it back', () => {
    internalizeSystemPagesAsRules(store, PROJECT_INPUT, [buildPage()]);

    const node = store.getNodeById(systemPageRuleId(PROJECT, '01-runtime-lifecycle'));
    expect(node?.metadata?.['systemPage']).toBe(true);
    expect(node?.metadata?.['classifications']).toEqual(['plugin-manifest', 'build-module']);
    expect(node?.metadata?.['knownConstraints']).toEqual(['Manifests are high impact.']);
    expect(node?.metadata?.['affectedChain']).toBe('.uproject -> Build.cs -> runtime/editor.');
    expect(node?.metadata?.['recommendedVerification']).toEqual(['Validate startup.']);
  });

  it('attaches canonical tags plus classification + page tags', () => {
    internalizeSystemPagesAsRules(store, PROJECT_INPUT, [buildPage()]);

    const node = store.getNodeById(systemPageRuleId(PROJECT, '01-runtime-lifecycle'));
    expect(node?.tags).toContain('architecture');
    expect(node?.tags).toContain(SYSTEM_PAGE_RULE_TAG);
    expect(node?.tags).toContain('system-page:01-runtime-lifecycle');
    expect(node?.tags).toContain('plugin-manifest');
    expect(node?.tags).toContain('runtime-lifecycle');
  });

  it('is idempotent: a second run with identical pages reports no changes', () => {
    internalizeSystemPagesAsRules(store, PROJECT_INPUT, [buildPage()]);

    const second = internalizeSystemPagesAsRules(store, PROJECT_INPUT, [buildPage()]);

    expect(second.created).toHaveLength(0);
    expect(second.updated).toHaveLength(0);
    expect(second.unchanged).toHaveLength(1);
  });

  it('updates existing nodes when page content changes', () => {
    internalizeSystemPagesAsRules(store, PROJECT_INPUT, [buildPage()]);

    const result = internalizeSystemPagesAsRules(store, PROJECT_INPUT, [buildPage({
      body: ['## Flow', '', '- .uproject defines plugins.', '- new line.'],
    })]);

    expect(result.updated).toHaveLength(1);
    expect(result.created).toHaveLength(0);
    expect(result.unchanged).toHaveLength(0);
    const node = store.getNodeById(systemPageRuleId(PROJECT, '01-runtime-lifecycle'));
    expect(node?.content).toContain('new line.');
  });

  it('handles pages without metadata (only canonical fields are persisted)', () => {
    const page = buildPage({ metadata: undefined });

    const result = internalizeSystemPagesAsRules(store, PROJECT_INPUT, [page]);

    expect(result.created).toHaveLength(1);
    const node = store.getNodeById(systemPageRuleId(PROJECT, '01-runtime-lifecycle'));
    expect(node?.metadata?.['classifications']).toBeUndefined();
    expect(node?.metadata?.['systemPage']).toBe(true);
  });

  it('prunes legacy obsidian-architecture:* RULE nodes left over from the removed importer', () => {
    // Simulate a stale node created by the deprecated
    // `importPlainArchitectureMarkdown` codepath.
    const legacyId = `obsidian-architecture:${PROJECT}:client-architecture-01-md`;
    store.createNode({
      id: legacyId,
      substrateType: SubstrateType.RULE,
      domainType: ContextDomainType.ARCHITECTURE,
      title: 'Stale Legacy Node',
      content: 'Body left over from the previous importer.',
      tags: ['architecture', 'obsidian-architecture'],
      project: PROJECT,
      compressionLevel: 0.1,
      confidence: 0.9,
      qualityScore: 90,
      status: ContextNodeStatus.VERIFIED,
      sourceRef: 'D:/some/old/architecture/01-runtime.md',
      metadata: { importer: 'obsidian-architecture-markdown' },
    });

    const result = internalizeSystemPagesAsRules(store, PROJECT_INPUT, [buildPage()]);

    expect(result.prunedLegacy).toContain(legacyId);
    expect(store.getNodeById(legacyId)).toBeNull();
    // A second run should report no further prunes — the cleanup is idempotent.
    const second = internalizeSystemPagesAsRules(store, PROJECT_INPUT, [buildPage()]);
    expect(second.prunedLegacy).toHaveLength(0);
  });
});
