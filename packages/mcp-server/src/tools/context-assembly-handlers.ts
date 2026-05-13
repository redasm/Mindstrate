import type { AssembledContext, AssembledRetrieval, ProjectGraphContextFact } from '@mindstrate/protocol';
import type { McpApi, McpToolResponse } from '../types.js';
import { appendGraphContextSections } from './memory-handlers.js';

type ToolInput = any;

export async function handleContextAssemble(
  api: McpApi,
  input: ToolInput,
): Promise<McpToolResponse> {
  const { task, project, language, framework, currentFile } = input;

  const assembled = await api.assembleContext(task, {
    project,
    context: {
      project,
      currentFile,
      currentLanguage: language,
      currentFramework: framework,
    },
  });

  let text = assembled.summary;
  if (assembled.projectSnapshot) {
    text += `\n\n### Project Snapshot ID\n- ${assembled.projectSnapshot.id}\n`;
  }
  text = appendGraphContextSections(text, assembled);
  text = appendProjectGraphContext(text, assembled.projectGraphContext);
  text = appendRetrievals(text, assembled.retrievals);

  return { content: [{ type: 'text', text }] };
}

/**
 * Render the project graph relationship facts as a Markdown section
 * with explicit node ids so the AI can copy them into follow-up tool
 * calls (`get_project_graph_node`, `get_project_graph_neighbors`,
 * `memory_feedback_auto`) without re-resolving them.
 */
const appendProjectGraphContext = (
  text: string,
  facts: ProjectGraphContextFact[] | undefined,
): string => {
  if (!facts || facts.length === 0) return text;
  const lines = facts.map((fact) => {
    const evidence = fact.evidence.length > 0 ? ` — evidence: ${fact.evidence.join(', ')}` : '';
    return `- [${fact.source}] ${fact.label} (${fact.kind})${evidence}\n  - id: ${fact.nodeId}`;
  });
  return `${text}\n\n### Project Graph Relationships\n${lines.join('\n')}\n`;
};

/**
 * Surface the per-node retrieval tickets and instruct the AI to close
 * the feedback loop. Borrowed from ACE's "generator self-reports
 * used bullet ids" pattern: AI is responsible for replying with a
 * `memory_feedback_auto` call for each retrieval id, marking it
 * `adopted` (used in the answer), `partial` (referenced but not
 * decisive), `rejected` (saw it but it was wrong/irrelevant), or
 * `ignored` (did not use). These signals feed
 * `feedbackLoop.applyFeedbackToNode`, which raises / lowers
 * `positiveFeedback` / `negativeFeedback` on the source nodes; that in
 * turn drives `ContextPrioritySelector.scoreNode` for future
 * assemblies. Without this loop the priority scores stay flat
 * regardless of whether the AI actually used the surfaced knowledge.
 */
const appendRetrievals = (
  text: string,
  retrievals: AssembledRetrieval[] | undefined,
): string => {
  if (!retrievals || retrievals.length === 0) return text;
  const lines = retrievals.map(
    (entry) => `- ${entry.origin}: ${entry.nodeId}\n  - retrievalId: ${entry.retrievalId}`,
  );
  return `${text}\n\n### Retrieval Tickets — please report which were used\nAfter you finish answering, call \`memory_feedback_auto\` once per ticket below with one of \`adopted\` / \`partial\` / \`ignored\` / \`rejected\` so the graph can learn which nodes actually informed your answer.\n${lines.join('\n')}\n`;
};

export async function handleContextInternalize(
  api: McpApi,
  input: ToolInput,
): Promise<McpToolResponse> {
  const accepted = input.accept
    ? await api.acceptInternalizationSuggestions(input)
    : undefined;
  const suggestions = accepted ?? await api.generateInternalizationSuggestions(input);
  const projectionRecordCount = accepted?.records.length;
  const text = [
    input.accept ? '### Accepted Internalization' : '### Internalization Suggestions',
    '',
    '### AGENTS.md Suggestion',
    suggestions.agentsMd,
    '',
    '### Project Snapshot Fragment',
    suggestions.projectSnapshotFragment,
    '',
    '### System Prompt Fragment',
    suggestions.systemPromptFragment,
    '',
    '### Fine-Tune Dataset JSONL',
    suggestions.fineTuneDatasetJsonl,
    '',
    `Source Node IDs: ${suggestions.sourceNodeIds.join(', ') || '(none)'}`,
    projectionRecordCount !== undefined ? `Projection Records: ${projectionRecordCount}` : '',
  ].join('\n');

  return { content: [{ type: 'text', text }] };
}

// Internal export kept small and explicit so future callers (e.g. CLI
// wrappers that want the same Markdown without going through MCP) can
// reuse the same renderers without scraping handler return shape.
export { appendProjectGraphContext, appendRetrievals };
