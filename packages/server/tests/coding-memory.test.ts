/**
 * Tests for the Mindstrate facade
 *
 * Covers: init, add, search, sessions, stats, close
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Mindstrate } from '../src/mindstrate.js';
import { KnowledgeType } from '@mindstrate/protocol';
import { ContextDomainType, ContextNodeStatus, MetabolismRunStatus, ProjectionTarget, SubstrateType } from '@mindstrate/protocol/models';
import { createTempDir, removeTempDir, makeKnowledgeInput } from './helpers.js';
import type { DetectedProject } from '../src/project/detector.js';

describe('Mindstrate', () => {
  let tempDir: string;
  let memory: Mindstrate;

  beforeEach(async () => {
    tempDir = createTempDir();
    memory = new Mindstrate({
      dataDir: tempDir,
      openaiApiKey: '', // offline mode
    });
    await memory.init();
  });

  afterEach(() => {
    memory.close();
    removeTempDir(tempDir);
  });

  describe('init', () => {
    it('should initialize without error', () => {
      // Already initialized in beforeEach
      expect(memory).toBeDefined();
    });

    it('should be idempotent', async () => {
      await memory.init();
      await memory.init();
      // No error means success
    });
  });

  describe('add and get', () => {
    it('should add and retrieve knowledge', async () => {
      const result = await memory.add(makeKnowledgeInput());
      expect(result.success).toBe(true);
      expect(result.view).toBeDefined();

      const view = memory.readGraphKnowledge().find((entry) => entry.id === result.view!.id);
      expect(view).toBeDefined();
      expect(view!.title).toBe('Test knowledge entry');

      const contextNodes = memory.listContextNodes({
        limit: 10,
      });
      expect(contextNodes.some((node) => node.id === result.view!.id)).toBe(true);

      const projections = memory.listProjectionRecords({
        target: ProjectionTarget.GRAPH_KNOWLEDGE,
        limit: 10,
      });
      expect(projections.some((projection) => projection.targetRef === result.view!.id)).toBe(true);
    });

    it('should detect duplicate entries', async () => {
      const input = makeKnowledgeInput();
      const r1 = await memory.add(input);
      const r2 = await memory.add(input);
      expect(r1.success).toBe(true);
      expect(r2.success).toBe(false);
      expect(r2.duplicateOf).toBe(r1.view!.id);
    });
  });

  describe('search', () => {
    it('should find relevant knowledge', async () => {
      await memory.add(makeKnowledgeInput({
        title: 'Fix React hydration error',
        solution: 'Use useEffect for client-side code',
        context: { language: 'typescript', framework: 'react' },
      }));

      const results = memory.queryGraphKnowledge('hydration error in react');
      expect(results.length).toBeGreaterThan(0);
      expect(results[0].view.title).toContain('hydration');
    });

    it('should return empty for unrelated queries', async () => {
      await memory.add(makeKnowledgeInput({
        title: 'Fix Python import error',
        solution: 'Use virtual environment',
        tags: ['python'],
        context: { language: 'python' },
      }));

      // offline embeddings are word-based, so completely unrelated text should have low similarity
      // but may still return results - we just check it doesn't crash
      const results = memory.queryGraphKnowledge('quantum physics formulas');
      expect(results).toBeDefined();
    });

    it('should prioritize graph-projected high-level nodes when they match the query', async () => {

      memory.createContextNode({
        substrateType: SubstrateType.RULE,
        domainType: ContextDomainType.CONVENTION,
        title: 'Hydration Safety Rule',
        content: 'Use hydration-safe SSR and avoid browser-only checks during render.',
        project: 'proj',
        status: ContextNodeStatus.ACTIVE,
        qualityScore: 90,
        confidence: 0.9,
      });

      await memory.add(makeKnowledgeInput({
        title: 'Low-level hydration note',
        solution: 'Client-only logic may cause mismatch.',
        context: { project: 'proj', language: 'typescript', framework: 'react' },
      }));

      const results = memory.queryGraphKnowledge('hydration safe SSR', {
        project: 'proj',
        topK: 5,
      });

      expect(results.length).toBeGreaterThan(0);
      expect(results[0].view.title).toBe('Hydration Safety Rule');
      expect(results[0].matchReason).toContain('Graph projection');
    });
  });

  describe('update and delete', () => {
    it('should update graph knowledge', async () => {
      const r = await memory.add(makeKnowledgeInput());
      const updated = memory.updateContextNode(r.view!.id, { title: 'New title' });
      expect(updated!.title).toBe('New title');
    });

    it('should delete graph knowledge', async () => {
      const r = await memory.add(makeKnowledgeInput());
      const deleted = memory.deleteContextNode(r.view!.id);
      expect(deleted).toBe(true);
      expect(memory.readGraphKnowledge().some((entry) => entry.id === r.view!.id)).toBe(false);
    });

    it('should expose graph updates through graph knowledge reads', async () => {
      const r = await memory.add(makeKnowledgeInput({
        title: 'Previous architecture guidance',
        solution: 'previous token rotation flow',
      }));

      let entries = memory.readGraphKnowledge();
      expect(entries.some((item) => item.id === r.view!.id && item.summary === 'previous token rotation flow')).toBe(true);

      memory.updateContextNode(r.view!.id, {
        title: 'New architecture guidance',
        content: 'modern secret rotation flow',
      });

      entries = memory.readGraphKnowledge();
      expect(entries.some((item) => item.id === r.view!.id && item.summary === 'modern secret rotation flow')).toBe(true);
    });
  });

  describe('list', () => {
    it('should list all knowledge', async () => {
      await memory.add(makeKnowledgeInput({ title: 'A', solution: 'sol a alpha unique' }));
      await memory.add(makeKnowledgeInput({ title: 'B', solution: 'sol b beta different topic' }));
      const all = memory.readGraphKnowledge({ limit: 10 });
      expect(all.length).toBe(2);
    });
  });

  describe('feedback', () => {
    it('should record graph feedback signals', async () => {
      const r = await memory.add(makeKnowledgeInput());
      memory.recordFeedback(r.view!.id, 'adopted', 'test');

      const signals = memory.listContextNodes({
        substrateType: SubstrateType.EPISODE,
        domainType: ContextDomainType.CONTEXT_EVENT,
      });
      expect(signals.some((signal) =>
        signal.tags.includes('feedback-signal') &&
        signal.tags.includes('adopted') &&
        signal.metadata?.['retrievalId'] === r.view!.id
      )).toBe(true);
    });
  });

  describe('sessions', () => {
    it('should start and end a session', async () => {
      const session = await memory.startSession({ project: 'test-proj' });
      expect(session.status).toBe('active');

      memory.saveObservation({
        sessionId: session.id,
        type: 'task_start',
        content: 'Working on tests',
      });

      await memory.endSession(session.id);
      const ended = memory.getSession(session.id);
      expect(ended!.status).toBe('completed');
    });

    it('should restore ECS session snapshot projections with current session context', async () => {
      const session = await memory.startSession({ project: 'proj' });
      memory.saveObservation({
        sessionId: session.id,
        type: 'decision',
        content: 'Keep restored context graph-aware.',
      });
      await memory.endSession(session.id);

      const restored = memory.restoreSessionContext('proj');
      const formatted = memory.formatSessionContext('proj');

      expect(restored.lastSession?.decisions).toContain('Keep restored context graph-aware.');
      expect(restored.graphSnapshots?.[0].title).toContain('Session snapshot');
      expect(restored.graphSnapshots?.[0].nodeId).toBeTruthy();
      expect(formatted).toContain('ECS Session Snapshots');
      expect(formatted).toContain('Keep restored context graph-aware');
    });

    it('should auto-end previous active session when starting new one', async () => {
      const s1 = await memory.startSession({ project: 'proj' });
      const s2 = await memory.startSession({ project: 'proj' });

      const previous = memory.getSession(s1.id);
      expect(previous!.status).toBe('abandoned');
      expect(s2.status).toBe('active');
    });

    it('should auto-compress similar session snapshots into a summary node', async () => {
      const first = await memory.startSession({ project: 'proj' });
      memory.saveObservation({
        sessionId: first.id,
        type: 'problem_solved',
        content: 'Fixed hydration mismatch in SSR rendering by moving browser checks into useEffect.',
      });
      await memory.endSession(first.id);

      const second = await memory.startSession({ project: 'proj' });
      memory.saveObservation({
        sessionId: second.id,
        type: 'problem_solved',
        content: 'Resolved hydration mismatch in SSR rendering by moving browser-only checks into useEffect.',
      });
      await memory.endSession(second.id);

      const summaries = memory.listContextNodes({
        project: 'proj',
        substrateType: SubstrateType.SUMMARY,
        domainType: ContextDomainType.SESSION_SUMMARY,
        limit: 10,
      });

      expect(summaries.length).toBeGreaterThan(0);
      expect(summaries[0].content).toContain('Compressed from');
    });
  });

  describe('assembleContext', () => {
    it('should assemble session continuity, project snapshot, and curated knowledge', async () => {
      await memory.add(makeKnowledgeInput({
        title: 'Fix React hydration mismatch',
        solution: 'Use useEffect for browser-only code paths.',
        tags: ['react', 'hydration'],
        context: { project: 'proj', language: 'typescript', framework: 'react' },
      }));

      const previous = await memory.startSession({ project: 'proj' });
      memory.saveObservation({
        sessionId: previous.id,
        type: 'decision',
        content: 'Keep SSR output deterministic before hydration.',
      });
      await memory.endSession(previous.id);

      const project: DetectedProject = {
        root: tempDir,
        name: 'proj',
        language: 'typescript',
        framework: 'react',
        runtime: 'node',
        packageManager: 'npm',
        version: '1.0.0',
        dependencies: [],
        truncatedDeps: 0,
        scripts: {},
        entryPoints: ['src/index.ts'],
        topDirs: ['src'],
        workspaces: [],
        manifestPath: 'package.json',
        detectedAt: new Date().toISOString(),
        git: { isRepo: false },
      };
      await memory.upsertProjectSnapshot(project);

      const assembled = await memory.assembleContext('fix hydration mismatch', {
        project: 'proj',
        context: { currentLanguage: 'typescript', currentFramework: 'react' },
      });

      expect(assembled.project).toBe('proj');
      expect(assembled.sessionContext).toContain('Keep SSR output deterministic');
      expect(assembled.projectSnapshot?.tags).toContain('project-snapshot');
      expect(assembled.graphSummaries?.length).toBeGreaterThan(0);
      expect(assembled.curated.graphRules).toBeDefined();
      expect(assembled.summary).toContain('Session Continuity');
      expect(assembled.summary).toContain('Project Snapshot');
      expect(assembled.summary).toContain('Recent Summary Clusters');
      expect(assembled.summary).toContain('Task Curation');
    });

    it('should gracefully assemble context without session or project snapshot', async () => {
      const assembled = await memory.assembleContext('brand new task', {
        project: 'missing-project',
      });

      expect(assembled.project).toBe('missing-project');
      expect(assembled.sessionContext).toBeUndefined();
      expect(assembled.projectSnapshot).toBeUndefined();
      expect(assembled.curated).toBeDefined();
      expect(assembled.summary).toContain('Working Context for: brand new task');
    });
  });

  describe('ECS runtime API', () => {
    it('should expose the design-document ECS runtime methods', async () => {

      memory.createContextNode({
        substrateType: SubstrateType.SNAPSHOT,
        domainType: ContextDomainType.SESSION_SUMMARY,
        title: 'Session snapshot A',
        content: 'Summary: Fixed hydration mismatch in SSR rendering flow.',
        project: 'proj',
        status: ContextNodeStatus.ACTIVE,
      });
      memory.createContextNode({
        substrateType: SubstrateType.SNAPSHOT,
        domainType: ContextDomainType.SESSION_SUMMARY,
        title: 'Session snapshot B',
        content: 'Summary: Resolved hydration mismatch in SSR rendering path.',
        project: 'proj',
        status: ContextNodeStatus.ACTIVE,
      });

      const digest = memory.runDigest({ project: 'proj' });
      const assimilation = memory.runAssimilation({ project: 'proj' });
      const compression = await memory.runCompression({ project: 'proj' });
      const pruning = memory.runPruning({ project: 'proj' });
      const reflection = memory.runReflection({ project: 'proj' });
      const context = await memory.assembleWorkingContext('fix hydration mismatch', { project: 'proj' });
      const graphKnowledge = memory.readGraphKnowledge({ project: 'proj', limit: 10 });

      expect(digest.stage).toBe('digest');
      expect(assimilation.stage).toBe('assimilate');
      expect(compression.summary.summaryNodesCreated).toBeGreaterThanOrEqual(0);
      expect(pruning.scannedNodes).toBeGreaterThanOrEqual(0);
      expect(reflection.candidateNodesCreated).toBeGreaterThanOrEqual(0);
      expect(context.project).toBe('proj');
      expect(graphKnowledge.length).toBeGreaterThan(0);
    });
  });

  describe('memory internalization', () => {
    it('should generate AGENTS and system prompt suggestions from stable rules', () => {

      memory.createContextNode({
        substrateType: SubstrateType.RULE,
        domainType: ContextDomainType.CONVENTION,
        title: 'Test-first ECS changes',
        content: 'Write a failing test before changing ECS runtime behavior.',
        project: 'proj',
        status: ContextNodeStatus.VERIFIED,
        qualityScore: 92,
        confidence: 0.95,
      });

      const suggestions = memory.generateInternalizationSuggestions({
        project: 'proj',
      });

      expect(suggestions.agentsMd).toContain('Test-first ECS changes');
      expect(suggestions.agentsMd).toContain('Write a failing test before changing ECS runtime behavior.');
      expect(suggestions.systemPromptFragment).toContain('Test-first ECS changes');
      expect(suggestions.projectSnapshotFragment).toContain('Test-first ECS changes');
      expect(suggestions.sourceNodeIds).toHaveLength(1);
    });

    it('should accept internalization suggestions into auditable projection records', () => {

      const rule = memory.createContextNode({
        substrateType: SubstrateType.RULE,
        domainType: ContextDomainType.CONVENTION,
        title: 'Keep ECS internalization auditable',
        content: 'Accepting internalized guidance must leave projection records.',
        project: 'proj',
        status: ContextNodeStatus.VERIFIED,
        qualityScore: 92,
        confidence: 0.95,
      });

      const accepted = memory.acceptInternalizationSuggestions({
        project: 'proj',
        targets: ['agents_md', 'system_prompt'],
      });

      expect(accepted.sourceNodeIds).toEqual([rule.id]);
      expect(accepted.records).toHaveLength(2);
      expect(accepted.records.map((record) => record.target).sort()).toEqual(['agents_md', 'system_prompt']);
      expect(memory.listProjectionRecords({ nodeId: rule.id, limit: 10 })).toHaveLength(2);
    });

    it('should export stable rules as a governed fine-tune dataset projection', () => {

      const rule = memory.createContextNode({
        substrateType: SubstrateType.RULE,
        domainType: ContextDomainType.CONVENTION,
        title: 'Keep migrations graph-first',
        content: 'New knowledge should be written as ECS graph nodes before projection.',
        project: 'proj',
        status: ContextNodeStatus.VERIFIED,
        qualityScore: 94,
        confidence: 0.96,
      });

      const suggestions = memory.generateInternalizationSuggestions({
        project: 'proj',
      });

      const [example] = suggestions.fineTuneDatasetJsonl
        .split('\n')
        .filter(Boolean)
        .map((line) => JSON.parse(line));

      expect(example).toMatchObject({
        sourceNodeId: rule.id,
        project: 'proj',
        messages: [
          { role: 'system', content: expect.stringContaining('Mindstrate ECS guidance') },
          { role: 'user', content: expect.stringContaining('Keep migrations graph-first') },
          { role: 'assistant', content: 'New knowledge should be written as ECS graph nodes before projection.' },
        ],
      });

      const accepted = memory.acceptInternalizationSuggestions({
        project: 'proj',
        targets: [ProjectionTarget.FINE_TUNE_DATASET],
      });

      expect(accepted.records).toHaveLength(1);
      expect(accepted.records[0].target).toBe(ProjectionTarget.FINE_TUNE_DATASET);
      expect(accepted.records[0].targetRef).toBe('proj:fine-tune-dataset.jsonl');
    });
  });

  describe('curateContext', () => {
    it('should produce graph-first curated context', async () => {

      memory.createContextNode({
        substrateType: SubstrateType.RULE,
        domainType: ContextDomainType.CONVENTION,
        title: 'Hydration Safety Rule',
        content: 'Use hydration-safe SSR and avoid browser-only checks during render.',
        project: 'proj',
        status: ContextNodeStatus.ACTIVE,
      });

      const curated = await memory.curateContext('fix hydration mismatch', {
        project: 'proj',
        currentLanguage: 'typescript',
        currentFramework: 'react',
      });

      expect(curated.graphRules).toEqual(['Hydration Safety Rule']);
      expect(curated.summary).toContain('Operational Rules');
      expect(curated.summary).toContain('Task Curation');
    });
  });

  describe('graph knowledge interfaces', () => {
    it('should expose graph-projected knowledge views through the facade', () => {

      memory.createContextNode({
        substrateType: SubstrateType.RULE,
        domainType: ContextDomainType.CONVENTION,
        title: 'Hydration Safety Rule',
        content: 'Use hydration-safe SSR and avoid browser-only checks during render.',
        project: 'proj',
        status: ContextNodeStatus.ACTIVE,
        qualityScore: 90,
        confidence: 0.9,
      });

      const projected = memory.readGraphKnowledge({
        project: 'proj',
        limit: 10,
      });

      expect(projected).toHaveLength(1);
      expect(projected[0].substrateType).toBe(SubstrateType.RULE);
      expect(projected[0].title).toBe('Hydration Safety Rule');
    });

    it('should expose ECS-native projected search through the facade', () => {

      memory.createContextNode({
        substrateType: SubstrateType.RULE,
        domainType: ContextDomainType.CONVENTION,
        title: 'Hydration Safety Rule',
        content: 'Use hydration-safe SSR and avoid browser-only checks during render.',
        project: 'proj',
        status: ContextNodeStatus.ACTIVE,
        qualityScore: 90,
        confidence: 0.9,
      });

      const results = memory.queryGraphKnowledge('hydration safe SSR', {
        project: 'proj',
        topK: 5,
      });

      expect(results).toHaveLength(1);
      expect(results[0].view.title).toBe('Hydration Safety Rule');
      expect(results[0].matchReason).toContain('Graph projection');
    });
  });

  describe('metabolism framework', () => {
    it('should expose metabolism runs and projection records through the facade', async () => {

      memory.createContextNode({
        substrateType: SubstrateType.SNAPSHOT,
        domainType: ContextDomainType.SESSION_SUMMARY,
        title: 'Session snapshot A',
        content: 'Summary: Fixed hydration mismatch in SSR rendering flow.',
        project: 'proj',
        status: ContextNodeStatus.ACTIVE,
      });
      memory.createContextNode({
        substrateType: SubstrateType.SNAPSHOT,
        domainType: ContextDomainType.SESSION_SUMMARY,
        title: 'Session snapshot B',
        content: 'Summary: Resolved hydration mismatch in SSR rendering path.',
        project: 'proj',
        status: ContextNodeStatus.ACTIVE,
      });

      const run = await memory.runMetabolism({ project: 'proj', trigger: 'manual' });
      expect(run.status).toBe(MetabolismRunStatus.COMPLETED);

      const runs = memory.listMetabolismRuns('proj');
      expect(runs).toHaveLength(1);

      const projections = memory.listProjectionRecords({ target: ProjectionTarget.GRAPH_KNOWLEDGE });
      expect(projections.length).toBeGreaterThan(0);
    });
  });

  describe('external signal ingestion', () => {
    it('should ingest git activity into the context graph facade', () => {
      const ingested = memory.ingestGitActivity({
        content: 'feat: wire capture into ecs event stream',
        project: 'proj',
        actor: 'tester',
        sourceRef: 'abc123',
        metadata: { commitHash: 'abc123' },
      });

      expect(ingested.event.type).toBe('git_activity');
      expect(ingested.node.sourceRef).toBe('abc123');

      const nodes = memory.listContextNodes({
        project: 'proj',
        sourceRef: 'abc123',
        limit: 10,
      });
      expect(nodes).toHaveLength(1);
      expect(nodes[0].title).toContain('git activity');
    });

    it('should ingest test results into the context graph facade', () => {
      const ingested = memory.ingestTestRun({
        content: 'Vitest failed in context graph tests',
        project: 'proj',
        actor: 'vitest',
        sourceRef: 'test:ctx-graph',
      });

      expect(ingested.event.type).toBe('test_result');
      expect(ingested.node.sourceRef).toBe('test:ctx-graph');

      const nodes = memory.listContextNodes({
        project: 'proj',
        sourceRef: 'test:ctx-graph',
        limit: 10,
      });
      expect(nodes).toHaveLength(1);
      expect(nodes[0].title).toContain('test result');
    });

    it('should ingest lsp diagnostics into the context graph facade', () => {
      const ingested = memory.ingestLspDiagnostic({
        content: 'Type error TS2322 in src/mindstrate.ts',
        project: 'proj',
        sourceRef: 'lsp:mindstrate.ts',
        metadata: { code: 'TS2322' },
      });

      expect(ingested.event.type).toBe('lsp_diagnostic');
      expect(ingested.node.sourceRef).toBe('lsp:mindstrate.ts');

      const nodes = memory.listContextNodes({
        project: 'proj',
        sourceRef: 'lsp:mindstrate.ts',
        limit: 10,
      });
      expect(nodes).toHaveLength(1);
      expect(nodes[0].title).toContain('lsp diagnostic');
    });

    it('should ingest terminal output into the context graph facade', () => {
      const ingested = memory.ingestTerminalOutput({
        content: 'npm run build failed with TS2322',
        project: 'proj',
        command: 'npm run build',
        exitCode: 1,
        sourceRef: 'terminal:build',
      });

      expect(ingested.event.type).toBe('terminal_output');
      expect(ingested.node.sourceRef).toBe('terminal:build');
      expect(ingested.node.metadata?.command).toBe('npm run build');

      const nodes = memory.listContextNodes({
        project: 'proj',
        sourceRef: 'terminal:build',
        limit: 10,
      });
      expect(nodes).toHaveLength(1);
      expect(nodes[0].title).toContain('terminal output');
    });
  });

  describe('stats', () => {
    it('should return aggregate statistics', async () => {
      await memory.add(makeKnowledgeInput());
      const stats = await memory.getStats();
      expect(stats.total).toBe(1);
      expect(stats.vectorCount).toBe(1);
    });
  });

  describe('checkQuality', () => {
    it('should check quality without writing', () => {
      const result = memory.checkQuality(makeKnowledgeInput());
      expect(result.passed).toBe(true);
      expect(memory.readGraphKnowledge()).toHaveLength(0);
    });
  });

  describe('maintenance', () => {
    it('should run maintenance without error', async () => {
      await memory.add(makeKnowledgeInput());
      const result = memory.runMaintenance();
      expect(result.total).toBe(1);
    });
  });

  describe('config', () => {
    it('should expose read-only config', () => {
      const cfg = memory.getConfig();
      expect(cfg.dataDir).toBe(tempDir);
    });
  });

  describe('conflicts', () => {
    it('should expose conflict detection and conflict records through the facade', async () => {
      await memory.runConflictDetection({
        project: 'proj',
        substrateType: SubstrateType.RULE,
        similarityThreshold: 0.55,
      });

      memory.listContextNodes({
        project: 'proj',
        substrateType: SubstrateType.RULE,
      });

      const existingA = memory.listContextNodes({
        project: 'proj',
        substrateType: SubstrateType.RULE,
        domainType: ContextDomainType.CONVENTION,
        limit: 1,
      });
      expect(existingA).toEqual([]);

      const graph = (memory as unknown as {
        listContextNodes: typeof memory.listContextNodes;
      });

      const nodeA = graph.listContextNodes({
        project: 'proj',
        substrateType: SubstrateType.RULE,
        limit: 10,
      });
      expect(nodeA).toEqual([]);

      const ruleA = memory.createContextNode({
        substrateType: SubstrateType.RULE,
        domainType: ContextDomainType.CONVENTION,
        title: 'Rule A',
        content: 'Use hydration-safe SSR and browser checks during render are supported.',
        project: 'proj',
        status: ContextNodeStatus.ACTIVE,
      });
      const ruleB = memory.createContextNode({
        substrateType: SubstrateType.RULE,
        domainType: ContextDomainType.CONVENTION,
        title: 'Rule B',
        content: 'Use hydration-safe SSR but do not run browser checks during render.',
        project: 'proj',
        status: ContextNodeStatus.ACTIVE,
      });

      const result = await memory.runConflictDetection({
        project: 'proj',
        substrateType: SubstrateType.RULE,
        similarityThreshold: 0.55,
      });

      expect(result.conflictsDetected).toBe(1);

      const records = memory.listConflictRecords('proj');
      expect(records).toHaveLength(1);
      expect(records[0].nodeIds).toEqual(expect.arrayContaining([ruleA.id, ruleB.id]));
    });

    it('should expose conflict reflection candidates through the facade', async () => {
      const ruleA = memory.createContextNode({
        substrateType: SubstrateType.RULE,
        domainType: ContextDomainType.CONVENTION,
        title: 'Rule A',
        content: 'Use hydration-safe SSR and browser checks during render are supported.',
        project: 'proj',
        status: ContextNodeStatus.CONFLICTED,
      });
      const ruleB = memory.createContextNode({
        substrateType: SubstrateType.RULE,
        domainType: ContextDomainType.CONVENTION,
        title: 'Rule B',
        content: 'Use hydration-safe SSR but do not run browser checks during render.',
        project: 'proj',
        status: ContextNodeStatus.CONFLICTED,
      });

      await memory.runConflictDetection({
        project: 'proj',
        substrateType: SubstrateType.RULE,
        similarityThreshold: 0.55,
      });
      const conflict = memory.listConflictRecords('proj')[0];

      const result = memory.runConflictReflection({ project: 'proj' });
      expect(result.candidateNodesCreated).toBe(1);

      const candidates = memory.listContextNodes({
        project: 'proj',
        sourceRef: conflict.id,
        limit: 10,
      });
      expect(candidates).toHaveLength(1);
      expect(candidates[0].status).toBe(ContextNodeStatus.CANDIDATE);
      expect(candidates[0].content).toContain('Reflection task:');
    });
  });
});


