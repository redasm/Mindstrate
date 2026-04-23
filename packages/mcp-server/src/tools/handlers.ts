/**
 * MCP Tool Handlers
 *
 * Implements the logic for each MCP tool call.
 */

import { CaptureSource } from '@mindstrate/protocol';
import type { z } from 'zod';
import type { McpApi, McpToolResponse, SessionState } from '../types.js';
import type {
  GraphKnowledgeSearchSchema,
  MemorySearchSchema,
  MemoryAddSchema,
  MemoryFeedbackSchema,
  SessionSaveSchema,
  MemoryFeedbackAutoSchema,
  MemoryCurateSchema,
  ContextAssembleSchema,
  MemoryEvolveSchema,
} from './schemas.js';

export async function handleMemorySearch(
  api: McpApi,
  input: z.infer<typeof MemorySearchSchema>,
): Promise<McpToolResponse> {
  const { query, topK, language, framework, type } = input;

  const results = await api.search(query, {
    topK: topK ?? 5,
    filter: {
      language,
      framework,
      types: type ? [type] : undefined,
    },
  });

  if (results.length === 0) {
    return {
      content: [{ type: 'text', text: 'No relevant knowledge found in the team knowledge base.' }],
    };
  }

  const formatted = results.map((r, i) => {
    const k = r.knowledge;
    let text = `### ${i + 1}. [${k.type}] ${k.title}\n`;
    text += `Relevance: ${(r.relevanceScore * 100).toFixed(1)}% | Quality: ${k.quality.score.toFixed(0)}/100\n`;
    if (k.problem) text += `**Problem:** ${k.problem}\n`;
    text += `**Solution:** ${k.solution}\n`;
    if (k.actionable?.steps) {
      text += `**Steps:**\n${k.actionable.steps.map((s, j) => `  ${j + 1}. ${s}`).join('\n')}\n`;
    }
    if (k.tags.length > 0) text += `**Tags:** ${k.tags.join(', ')}\n`;
    text += `ID: ${k.id}\n`;
    if (r.retrievalId) text += `RetrievalID: ${r.retrievalId}\n`;
    return text;
  }).join('\n---\n\n');

  return {
    content: [{
      type: 'text',
      text: `Found ${results.length} relevant knowledge entries:\n\n${formatted}`,
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
      text: result.success && result.knowledge
        ? `Knowledge added successfully!\nID: ${result.knowledge.id}\nTitle: ${result.knowledge.title}`
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

  await api.saveObservation(sessionId, input.type, input.content);

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
