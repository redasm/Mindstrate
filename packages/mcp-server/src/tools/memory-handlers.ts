import { CaptureSource } from '@mindstrate/protocol';
import type { McpApi, McpToolResponse } from '../types.js';
import { formatGraphKnowledgeResults } from './graph-knowledge-format.js';

type ToolInput = any;

export async function handleMemorySearch(
  api: McpApi,
  input: ToolInput,
): Promise<McpToolResponse> {
  const { query, topK } = input;

  const results = await api.queryGraphKnowledge(query, {
    topK: topK ?? 5,
    limit: Math.max(topK ?? 5, 10),
  });

  return formatGraphKnowledgeResults(results, {
    empty: 'No relevant ECS graph knowledge found.',
    found: (count) => `Found ${count} relevant ECS graph knowledge views`,
  });
}

export async function handleGraphKnowledgeSearch(
  api: McpApi,
  input: ToolInput,
): Promise<McpToolResponse> {
  const { query, project, topK } = input;
  const results = await api.queryGraphKnowledge(query, {
    project,
    topK: topK ?? 5,
    limit: Math.max(topK ?? 5, 10),
  });

  return formatGraphKnowledgeResults(results, {
    empty: 'No relevant ECS graph knowledge views found.',
    found: (count) => `Found ${count} ECS graph knowledge views`,
  });
}

export async function handleMemoryAdd(
  api: McpApi,
  input: ToolInput,
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
  input: ToolInput,
): Promise<McpToolResponse> {
  const { id, signal, context } = input;
  await api.recordFeedback(id, signal, context);

  return {
    content: [{ type: 'text', text: `ECS feedback signal recorded: ${signal} for ${id}` }],
  };
}

export async function handleMemoryFeedbackAuto(
  api: McpApi,
  input: ToolInput,
): Promise<McpToolResponse> {
  const { retrievalId, signal, context: feedbackContext } = input;
  await api.recordFeedback(retrievalId, signal, feedbackContext);

  return {
    content: [{ type: 'text', text: `Feedback recorded: ${signal} for retrieval ${retrievalId}` }],
  };
}

export async function handleMemoryCurate(
  api: McpApi,
  input: ToolInput,
): Promise<McpToolResponse> {
  const { task, language, framework } = input;

  const curated = await api.curateContext(task, {
    currentLanguage: language,
    currentFramework: framework,
  });

  const text = appendGraphContextSections(curated.summary, curated);

  return { content: [{ type: 'text', text }] };
}

export async function handleMemoryEvolve(
  api: McpApi,
  input: ToolInput,
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
  response += `- Archive: ${evolveResult.summary.archive}\n`;
  response += `- LLM enhanced: ${evolveResult.llmEnhanced}\n`;
  response += `- Auto-applied: ${evolveResult.autoApplied}\n`;
  response += `- Pending review: ${evolveResult.pendingReview}\n`;

  if (evolveResult.suggestions.length > 0) {
    response += `\n### Suggestions:\n`;
    for (const s of evolveResult.suggestions.slice(0, 10)) {
      response += `- [${s.type}] ${s.description} (confidence: ${(s.confidence * 100).toFixed(0)}%)\n`;
      response += `  Node ID: ${s.nodeId}\n`;
    }
    if (evolveResult.suggestions.length > 10) {
      response += `... and ${evolveResult.suggestions.length - 10} more suggestions\n`;
    }
  }

  return { content: [{ type: 'text', text: response }] };
}

export function appendGraphContextSections(
  initialText: string,
  context: {
    graphRules?: string[];
    graphPatterns?: string[];
    graphSummaries?: string[];
    graphConflicts?: string[];
  },
): string {
  let text = initialText;
  text = appendMarkdownList(text, 'ECS Graph Rules', context.graphRules);
  text = appendMarkdownList(text, 'ECS Graph Patterns', context.graphPatterns);
  text = appendMarkdownList(text, 'ECS Graph Summaries', context.graphSummaries);
  return appendMarkdownList(text, 'ECS Graph Conflicts', context.graphConflicts);
}

function appendMarkdownList(text: string, title: string, items?: string[]): string {
  if (!items?.length) return text;
  return `${text}\n\n### ${title}\n${items.map((item) => `- ${item}`).join('\n')}\n`;
}
