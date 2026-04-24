/**
 * MCP Tool Handlers
 *
 * Implements the logic for each MCP tool call.
 */

import { CaptureSource, type ContextDomainType, type ContextEventType, type ContextNodeStatus } from '@mindstrate/protocol';
import type { z } from 'zod';
import type { McpApi, McpToolResponse, SessionState } from '../types.js';
import type {
  GraphKnowledgeSearchSchema,
  ContextIngestEventSchema,
  ContextQueryGraphSchema,
  ContextEdgesSchema,
  ContextConflictsSchema,
  ContextConflictAcceptSchema,
  ContextConflictRejectSchema,
  MetabolismRunSchema,
  ObsidianProjectionWriteSchema,
  ObsidianProjectionImportSchema,
  BundleCreateSchema,
  BundleValidateSchema,
  BundleInstallSchema,
  BundlePublishSchema,
  MemorySearchSchema,
  MemoryAddSchema,
  MemoryFeedbackSchema,
  SessionSaveSchema,
  MemoryFeedbackAutoSchema,
  MemoryCurateSchema,
  ContextAssembleSchema,
  ContextInternalizeSchema,
  MemoryEvolveSchema,
} from './schemas.js';

export async function handleMemorySearch(
  api: McpApi,
  input: z.infer<typeof MemorySearchSchema>,
): Promise<McpToolResponse> {
  const { query, topK } = input;

  const results = await api.queryGraphKnowledge(query, {
    topK: topK ?? 5,
    limit: Math.max(topK ?? 5, 10),
  });

  if (results.length === 0) {
    return {
      content: [{ type: 'text', text: 'No relevant ECS graph knowledge found.' }],
    };
  }

  const formatted = results.map((r, i) => {
    const view = r.view;
    return [
      `### ${i + 1}. [${view.substrateType}] ${view.title}`,
      `Relevance: ${(r.relevanceScore * 100).toFixed(1)}% | Priority: ${view.priorityScore.toFixed(2)}`,
      `Domain: ${view.domainType}`,
      `Summary: ${view.summary}`,
      view.tags.length > 0 ? `Tags: ${view.tags.join(', ')}` : null,
      `ID: ${view.id}`,
    ].filter(Boolean).join('\n');
  }).join('\n---\n\n');

  return {
    content: [{
      type: 'text',
      text: `Found ${results.length} relevant ECS graph knowledge views:\n\n${formatted}`,
    }],
  };
}

export async function handleGraphKnowledgeSearch(
  api: McpApi,
  input: z.infer<typeof GraphKnowledgeSearchSchema>,
): Promise<McpToolResponse> {
  const { query, project, topK } = input;
  const results = await api.queryGraphKnowledge(query, {
    project,
    topK: topK ?? 5,
    limit: Math.max(topK ?? 5, 10),
  });

  if (results.length === 0) {
    return {
      content: [{ type: 'text', text: 'No relevant ECS graph knowledge views found.' }],
    };
  }

  const formatted = results.map((result, index) => {
    const view = result.view;
    const lines = [
      `### ${index + 1}. [${view.substrateType}] ${view.title}`,
      `Relevance: ${(result.relevanceScore * 100).toFixed(1)}% | Priority: ${view.priorityScore.toFixed(2)}`,
      `Domain: ${view.domainType}`,
      `Summary: ${view.summary}`,
      view.tags.length > 0 ? `Tags: ${view.tags.join(', ')}` : null,
      `ID: ${view.id}`,
    ].filter(Boolean);
    return lines.join('\n');
  }).join('\n---\n\n');

  return {
    content: [{
      type: 'text',
      text: `Found ${results.length} ECS graph knowledge views:\n\n${formatted}`,
    }],
  };
}

export async function handleContextIngestEvent(
  api: McpApi,
  input: z.infer<typeof ContextIngestEventSchema>,
): Promise<McpToolResponse> {
  const result = await api.ingestContextEvent({
    ...input,
    type: input.type as ContextEventType,
    domainType: input.domainType as ContextDomainType | undefined,
  });
  return {
    content: [{
      type: 'text',
      text: `Context event ingested.\nEvent ID: ${result.eventId}\nNode ID: ${result.nodeId}`,
    }],
  };
}

export async function handleContextQueryGraph(
  api: McpApi,
  input: z.infer<typeof ContextQueryGraphSchema>,
): Promise<McpToolResponse> {
  const nodes = await api.queryContextGraph({
    query: input.query,
    project: input.project,
    substrateType: input.substrateType,
    domainType: input.domainType as ContextDomainType | undefined,
    status: input.status as ContextNodeStatus | undefined,
    limit: input.limit ?? 10,
  });

  if (nodes.length === 0) {
    return {
      content: [{ type: 'text', text: 'No ECS context graph nodes matched the query.' }],
    };
  }

  const formatted = nodes.map((node, index) => [
    `### ${index + 1}. [${node.substrateType}] ${node.title}`,
    `Domain: ${node.domainType} | Status: ${node.status} | Quality: ${node.qualityScore.toFixed(0)}`,
    node.project ? `Project: ${node.project}` : null,
    `Tags: ${node.tags.join(', ') || '(none)'}`,
    `ID: ${node.id}`,
  ].filter(Boolean).join('\n')).join('\n---\n\n');

  return {
    content: [{
      type: 'text',
      text: `Found ${nodes.length} ECS context nodes:\n\n${formatted}`,
    }],
  };
}

export async function handleContextEdges(
  api: McpApi,
  input: z.infer<typeof ContextEdgesSchema>,
): Promise<McpToolResponse> {
  const edges = await api.listContextEdges({
    sourceId: input.sourceId,
    targetId: input.targetId,
    relationType: input.relationType,
    limit: input.limit ?? 20,
  });

  if (edges.length === 0) {
    return {
      content: [{ type: 'text', text: 'No ECS context edges matched the query.' }],
    };
  }

  const formatted = edges.map((edge, index) => [
    `### ${index + 1}. ${edge.relationType}`,
    `Source: ${edge.sourceId}`,
    `Target: ${edge.targetId}`,
    `Strength: ${edge.strength.toFixed(2)}`,
    `ID: ${edge.id}`,
  ].join('\n')).join('\n---\n\n');

  return {
    content: [{
      type: 'text',
      text: `Found ${edges.length} ECS edges:\n\n${formatted}`,
    }],
  };
}

export async function handleContextConflicts(
  api: McpApi,
  input: z.infer<typeof ContextConflictsSchema>,
): Promise<McpToolResponse> {
  const conflicts = await api.listContextConflicts({
    project: input.project,
    limit: input.limit ?? 20,
  });

  if (conflicts.length === 0) {
    return {
      content: [{ type: 'text', text: 'No active ECS conflicts found.' }],
    };
  }

  const formatted = conflicts.map((conflict, index) => [
    `### ${index + 1}. ${conflict.reason}`,
    conflict.project ? `Project: ${conflict.project}` : null,
    `Nodes: ${conflict.nodeIds.join(', ')}`,
    `Detected: ${conflict.detectedAt}`,
    conflict.resolution ? `Resolution: ${conflict.resolution}` : null,
  ].filter(Boolean).join('\n')).join('\n---\n\n');

  return {
    content: [{
      type: 'text',
      text: `Found ${conflicts.length} ECS conflicts:\n\n${formatted}`,
    }],
  };
}

export async function handleContextConflictAccept(
  api: McpApi,
  input: z.infer<typeof ContextConflictAcceptSchema>,
): Promise<McpToolResponse> {
  const result = await api.acceptConflictCandidate(input);
  return {
    content: [{
      type: 'text',
      text: result.resolved
        ? `Conflict resolved.\nID: ${result.resolved.id}\nResolution: ${result.resolved.resolution ?? input.resolution}`
        : `Conflict candidate was not accepted: ${input.candidateNodeId}`,
    }],
    isError: result.resolved ? undefined : true,
  };
}

export async function handleContextConflictReject(
  api: McpApi,
  input: z.infer<typeof ContextConflictRejectSchema>,
): Promise<McpToolResponse> {
  await api.rejectConflictCandidate(input);
  return {
    content: [{
      type: 'text',
      text: `Conflict candidate rejected.\nConflict: ${input.conflictId}\nCandidate: ${input.candidateNodeId}`,
    }],
  };
}

export async function handleMetabolismRun(
  api: McpApi,
  input: z.infer<typeof MetabolismRunSchema>,
): Promise<McpToolResponse> {
  if (input.stage) {
    const result = await api.runMetabolismStage(input.stage, { project: input.project });
    return {
      content: [{
        type: 'text',
        text: `Metabolism stage completed.\n${JSON.stringify(result, null, 2)}`,
      }],
    };
  }

  const run = await api.runMetabolism({
    project: input.project,
    trigger: input.trigger ?? 'manual',
  });

  const stats = Object.entries(run.stageStats)
    .map(([stage, stat]) => `${stage}: scanned=${stat?.scanned ?? 0}, created=${stat?.created ?? 0}, skipped=${stat?.skipped ?? 0}`)
    .join('\n');

  return {
    content: [{
      type: 'text',
      text: [
        'Metabolism run completed.',
        `Run ID: ${run.id}`,
        `Status: ${run.status}`,
        run.project ? `Project: ${run.project}` : null,
        `Trigger: ${run.trigger}`,
        stats ? `\nStage Stats:\n${stats}` : null,
        run.notes?.length ? `\nNotes:\n${run.notes.map((note) => `- ${note}`).join('\n')}` : null,
      ].filter(Boolean).join('\n'),
    }],
  };
}

export async function handleObsidianProjectionWrite(
  api: McpApi,
  input: z.infer<typeof ObsidianProjectionWriteSchema>,
): Promise<McpToolResponse> {
  const result = await api.writeObsidianProjectionFiles({
    rootDir: input.rootDir,
    project: input.project,
    limit: input.limit,
  });

  return {
    content: [{
      type: 'text',
      text: result.files.length > 0
        ? `Wrote ${result.files.length} Obsidian projection files:\n${result.files.map((file) => `- ${file}`).join('\n')}`
        : 'No Obsidian projection files were written.',
    }],
  };
}

export async function handleObsidianProjectionImport(
  api: McpApi,
  input: z.infer<typeof ObsidianProjectionImportSchema>,
): Promise<McpToolResponse> {
  const result = await api.importObsidianProjectionFile(input.filePath);
  return {
    content: [{
      type: 'text',
      text: result.changed
        ? [
          'Obsidian projection edit imported.',
          `Source node: ${result.sourceNodeId}`,
          `Candidate: ${(result.candidateNode as { id?: string } | undefined)?.id ?? 'unknown'}`,
          `Event: ${(result.event as { id?: string } | undefined)?.id ?? 'unknown'}`,
        ].join('\n')
        : 'No ECS projection changes imported.',
    }],
  };
}

export async function handleBundleCreate(
  api: McpApi,
  input: z.infer<typeof BundleCreateSchema>,
): Promise<McpToolResponse> {
  const bundle = await api.createBundle(input);
  return {
    content: [{
      type: 'text',
      text: `Bundle created.\nID: ${bundle.id}\nName: ${bundle.name}\nNodes: ${bundle.nodeIds.length}\nEdges: ${bundle.edgeIds.length}`,
    }],
  };
}

export async function handleBundleValidate(
  api: McpApi,
  input: z.infer<typeof BundleValidateSchema>,
): Promise<McpToolResponse> {
  const result = await api.validateBundle(input.bundle);
  return {
    content: [{
      type: 'text',
      text: result.valid
        ? 'Bundle is valid.'
        : `Bundle validation failed:\n${result.errors.map((error) => `- ${error}`).join('\n')}`,
    }],
    isError: result.valid ? undefined : true,
  };
}

export async function handleBundleInstall(
  api: McpApi,
  input: z.infer<typeof BundleInstallSchema>,
): Promise<McpToolResponse> {
  if (!input.bundle && (!input.registry || !input.reference)) {
    return {
      content: [{
        type: 'text',
        text: 'Bundle install requires either bundle or registry plus reference.',
      }],
      isError: true,
    };
  }

  const result = input.bundle
    ? await api.installBundle(input.bundle)
    : await api.installBundleFromRegistry({
        registry: input.registry!,
        reference: input.reference!,
      });
  return {
    content: [{
      type: 'text',
      text: `Bundle installed.\nInstalled nodes: ${result.installedNodes}\nUpdated nodes: ${result.updatedNodes}\nInstalled edges: ${result.installedEdges}\nSkipped edges: ${result.skippedEdges}`,
    }],
  };
}

export async function handleBundlePublish(
  api: McpApi,
  input: z.infer<typeof BundlePublishSchema>,
): Promise<McpToolResponse> {
  const result = await api.publishBundle(input.bundle, {
    registry: input.registry,
    visibility: input.visibility,
  });

  return {
    content: [{
      type: 'text',
      text: [
        'Bundle publication manifest:',
        `ID: ${result.manifest.id}`,
        `Name: ${result.manifest.name}`,
        `Version: ${result.manifest.version}`,
        `Registry: ${result.manifest.registry}`,
        `Visibility: ${result.manifest.visibility}`,
        `Nodes: ${result.manifest.nodeCount}`,
        `Edges: ${result.manifest.edgeCount}`,
        `Digest: ${result.manifest.digest}`,
      ].join('\n'),
    }],
  };
}

export async function handleMemoryAdd(
  api: McpApi,
  input: z.infer<typeof MemoryAddSchema>,
): Promise<McpToolResponse> {
  const result = await api.add({
    type: input.type,
    title: input.title,
    problem: input.problem,
    solution: input.solution,
    tags: input.tags ?? [],
    context: {
      language: input.language,
      framework: input.framework,
    },
    source: CaptureSource.AI_CONVERSATION,
    actionable: input.actionable,
  });

  return {
    content: [{
      type: 'text',
      text: result.success && result.view
        ? `ECS context node added successfully!\nID: ${result.view.id}\nTitle: ${result.view.title}\nSubstrate: ${result.view.substrateType}`
        : `Note: ${result.message}`,
    }],
  };
}

export async function handleMemoryFeedback(
  api: McpApi,
  input: z.infer<typeof MemoryFeedbackSchema>,
): Promise<McpToolResponse> {
  const { id, vote } = input;

  const existing = await api.get(id);
  if (!existing) {
    return {
      content: [{ type: 'text', text: `Knowledge not found: ${id}` }],
      isError: true,
    };
  }

  if (vote === 'up') {
    await api.upvote(id);
  } else {
    await api.downvote(id);
  }

  return {
    content: [{ type: 'text', text: `Feedback recorded: ${vote}vote for ${id}` }],
  };
}

export async function handleSessionStart(
  api: McpApi,
  args: Record<string, unknown> | undefined,
  session: SessionState,
): Promise<McpToolResponse> {
  const project = (args?.project as string) ?? '';
  const { session: sess, context } = await api.startSession(
    project,
    args?.techContext as string | undefined,
  );

  session.currentSessionId = sess.id;
  session.currentSessionProject = project;

  let response = `Session started: ${sess.id}\nProject: ${project || '(default)'}`;
  if (context) {
    response += `\n\n${context}`;
  } else {
    response += '\n\nNo previous session context found. This is a fresh start.';
  }

  return { content: [{ type: 'text', text: response }] };
}

export async function handleSessionSave(
  api: McpApi,
  input: z.infer<typeof SessionSaveSchema>,
  session: SessionState,
): Promise<McpToolResponse> {
  let sessionId = session.currentSessionId;
  if (!sessionId) {
    const activeSession = await api.getActiveSession(session.currentSessionProject);
    sessionId = activeSession?.id ?? null;
  }

  if (!sessionId) {
    return {
      content: [{ type: 'text', text: 'No active session. Call session_start first.' }],
      isError: true,
    };
  }

  await api.saveObservation(sessionId, input.type, input.content, input.metadata);

  return {
    content: [{ type: 'text', text: `Observation saved: [${input.type}] ${input.content.substring(0, 80)}` }],
  };
}

export async function handleSessionEnd(
  api: McpApi,
  args: Record<string, unknown> | undefined,
  session: SessionState,
): Promise<McpToolResponse> {
  let sessionId = session.currentSessionId;
  if (!sessionId) {
    const active = await api.getActiveSession(session.currentSessionProject);
    sessionId = active?.id ?? null;
  }

  if (!sessionId) {
    return {
      content: [{ type: 'text', text: 'No active session to end.' }],
    };
  }

  await api.endSession(
    sessionId,
    args?.summary as string | undefined,
    args?.openTasks as string[] | undefined,
  );

  const sess = await api.getSession(sessionId);
  session.currentSessionId = null;

  return {
    content: [{
      type: 'text',
      text: `Session ended: ${sessionId}\nSummary: ${sess?.summary ?? 'auto-generated'}`,
    }],
  };
}

export async function handleSessionRestore(
  api: McpApi,
  args: Record<string, unknown> | undefined,
): Promise<McpToolResponse> {
  const project = (args?.project as string) ?? '';
  const context = await api.formatSessionContext(project);

  if (!context) {
    return {
      content: [{ type: 'text', text: 'No previous session context found for this project.' }],
    };
  }

  return { content: [{ type: 'text', text: context }] };
}

export async function handleMemoryFeedbackAuto(
  api: McpApi,
  input: z.infer<typeof MemoryFeedbackAutoSchema>,
): Promise<McpToolResponse> {
  const { retrievalId, signal, context: feedbackContext } = input;
  await api.recordFeedback(retrievalId, signal, feedbackContext);

  return {
    content: [{ type: 'text', text: `Feedback recorded: ${signal} for retrieval ${retrievalId}` }],
  };
}

export async function handleMemoryCurate(
  api: McpApi,
  input: z.infer<typeof MemoryCurateSchema>,
): Promise<McpToolResponse> {
  const { task, language, framework } = input;

  const curated = await api.curateContext(task, {
    currentLanguage: language,
    currentFramework: framework,
  });

  let text = curated.summary;
  if ((curated.graphRules?.length ?? 0) > 0) {
    text += '\n\n### ECS Graph Rules\n';
    for (const rule of curated.graphRules ?? []) {
      text += `- ${rule}\n`;
    }
  }
  if ((curated.graphPatterns?.length ?? 0) > 0) {
    text += '\n### ECS Graph Patterns\n';
    for (const pattern of curated.graphPatterns ?? []) {
      text += `- ${pattern}\n`;
    }
  }
  if ((curated.graphSummaries?.length ?? 0) > 0) {
    text += '\n### ECS Graph Summaries\n';
    for (const summary of curated.graphSummaries ?? []) {
      text += `- ${summary}\n`;
    }
  }
  if ((curated.graphConflicts?.length ?? 0) > 0) {
    text += '\n### ECS Graph Conflicts\n';
    for (const conflict of curated.graphConflicts ?? []) {
      text += `- ${conflict}\n`;
    }
  }

  const allResults = [
    ...curated.knowledge,
    ...curated.workflows,
    ...curated.warnings,
  ];
  if (allResults.length > 0) {
    text += '\n\n### Knowledge IDs for Feedback\n';
    for (const r of allResults) {
      text += `- ${r.knowledge.id}`;
      if (r.retrievalId) text += ` (retrievalId: ${r.retrievalId})`;
      text += '\n';
    }
  }

  return { content: [{ type: 'text', text }] };
}

export async function handleContextAssemble(
  api: McpApi,
  input: z.infer<typeof ContextAssembleSchema>,
): Promise<McpToolResponse> {
  const { task, project, language, framework } = input;

  const assembled = await api.assembleContext(task, {
    project,
    context: {
      project,
      currentLanguage: language,
      currentFramework: framework,
    },
  });

  let text = assembled.summary;
  if (assembled.projectSnapshot) {
    text += `\n\n### Project Snapshot ID\n- ${assembled.projectSnapshot.id}\n`;
  }
  if ((assembled.graphRules?.length ?? 0) > 0) {
    text += '\n### ECS Graph Rules\n';
    for (const rule of assembled.graphRules ?? []) {
      text += `- ${rule}\n`;
    }
  }
  if ((assembled.graphPatterns?.length ?? 0) > 0) {
    text += '\n### ECS Graph Patterns\n';
    for (const pattern of assembled.graphPatterns ?? []) {
      text += `- ${pattern}\n`;
    }
  }
  if ((assembled.graphSummaries?.length ?? 0) > 0) {
    text += '\n### ECS Graph Summaries\n';
    for (const summary of assembled.graphSummaries ?? []) {
      text += `- ${summary}\n`;
    }
  }
  if ((assembled.graphConflicts?.length ?? 0) > 0) {
    text += '\n### ECS Graph Conflicts\n';
    for (const conflict of assembled.graphConflicts ?? []) {
      text += `- ${conflict}\n`;
    }
  }

  const allResults = [
    ...assembled.curated.knowledge,
    ...assembled.curated.workflows,
    ...assembled.curated.warnings,
  ];
  if (allResults.length > 0) {
    text += '\n### Knowledge IDs for Feedback\n';
    for (const result of allResults) {
      text += `- ${result.knowledge.id}`;
      if (result.retrievalId) text += ` (retrievalId: ${result.retrievalId})`;
      text += '\n';
    }
  }

  return { content: [{ type: 'text', text }] };
}

export async function handleContextInternalize(
  api: McpApi,
  input: z.infer<typeof ContextInternalizeSchema>,
): Promise<McpToolResponse> {
  const suggestions = await api.generateInternalizationSuggestions(input);
  const text = [
    '### AGENTS.md Suggestion',
    suggestions.agentsMd,
    '',
    '### Project Snapshot Fragment',
    suggestions.projectSnapshotFragment,
    '',
    '### System Prompt Fragment',
    suggestions.systemPromptFragment,
    '',
    `Source Node IDs: ${suggestions.sourceNodeIds.join(', ') || '(none)'}`,
  ].join('\n');

  return { content: [{ type: 'text', text }] };
}

export async function handleMemoryEvolve(
  api: McpApi,
  input: z.infer<typeof MemoryEvolveSchema>,
): Promise<McpToolResponse> {
  const { autoApply, maxItems, mode } = input;

  const evolveResult = await api.runEvolution({
    autoApply: autoApply ?? false,
    maxItems: maxItems ?? 100,
    mode: mode ?? 'standard',
  });

  let response = `Evolution scan complete (${evolveResult.mode} mode):\n`;
  response += `- Scanned: ${evolveResult.scanned} entries\n`;
  response += `- Suggestions: ${evolveResult.suggestions.length}\n`;
  response += `- Merge: ${evolveResult.summary.merge}\n`;
  response += `- Improve: ${evolveResult.summary.improve}\n`;
  response += `- Deprecate: ${evolveResult.summary.deprecate}\n`;
  response += `- LLM enhanced: ${evolveResult.llmEnhanced}\n`;
  response += `- Auto-applied: ${evolveResult.autoApplied}\n`;
  response += `- Pending review: ${evolveResult.pendingReview}\n`;

  if (evolveResult.suggestions.length > 0) {
    response += `\n### Suggestions:\n`;
    for (const s of evolveResult.suggestions.slice(0, 10)) {
      response += `- [${s.type}] ${s.description} (confidence: ${(s.confidence * 100).toFixed(0)}%)\n`;
      response += `  Knowledge ID: ${s.knowledgeId}\n`;
    }
    if (evolveResult.suggestions.length > 10) {
      response += `... and ${evolveResult.suggestions.length - 10} more suggestions\n`;
    }
  }

  return { content: [{ type: 'text', text: response }] };
}
