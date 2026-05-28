import type { AssembledContext, AssembledRetrieval, ProjectGraphContextFact } from '@mindstrate/protocol';
import type { McpApi, McpToolResponse } from '../types.js';
import { assertProjectAllowed } from '../allowed-projects.js';
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
  text = appendProjectGraphContext(text, assembled.projectGraphContext, { project, currentFile });
  text = appendRetrievals(text, assembled.retrievals, { task, project });

  return { content: [{ type: 'text', text }] };
}

interface ContextAssembleDiagnostics {
  project?: string;
  currentFile?: string;
  task?: string;
}

/**
 * Render the project graph relationship facts as a Markdown section
 * with explicit node ids so the AI can copy them into follow-up tool
 * calls (`get_project_graph_node`, `get_project_graph_neighbors`,
 * `memory_feedback_auto`) without re-resolving them.
 *
 * When no facts surfaced, the section is still emitted with a
 * diagnostic line. Silently dropping it used to make the assembled
 * output look like the feature was never wired up, while the actual
 * cause was always either a missing `project` argument, a project name
 * mismatch (`Mindstrate` vs `mindstrate`), or an architecture book that
 * has not been internalized yet (run `mindstrate graph sync --vault
 * <path>` / `mindstrate init` to fix).
 */
const appendProjectGraphContext = (
  text: string,
  facts: ProjectGraphContextFact[] | undefined,
  diagnostics: Pick<ContextAssembleDiagnostics, 'project' | 'currentFile'>,
): string => {
  if (facts && facts.length > 0) {
    const lines = facts.map((fact) => {
      const evidence = fact.evidence.length > 0 ? ` — evidence: ${fact.evidence.join(', ')}` : '';
      return `- [${fact.source}] ${fact.label} (${fact.kind})${evidence}\n  - id: ${fact.nodeId}`;
    });
    return `${text}\n\n### Project Graph Relationships\n${lines.join('\n')}\n`;
  }
  const reasons: string[] = [];
  if (!diagnostics.project) {
    reasons.push('no `project` argument was supplied (project graph facts are project-scoped)');
  }
  if (!diagnostics.currentFile) {
    reasons.push('no `currentFile` seed was supplied to anchor the 1-hop expansion');
  }
  if (diagnostics.project && diagnostics.currentFile) {
    reasons.push('no architecture nodes matched — verify the project graph has been indexed (`mindstrate graph sync --vault <path>`) and that `project` matches the slug used during setup');
  }
  const reasonLine = reasons.length > 0
    ? reasons.map((reason) => `- ${reason}`).join('\n')
    : '- (no project graph context selected for this task)';
  return `${text}\n\n### Project Graph Relationships\n_No project graph facts were surfaced. Likely cause(s):_\n${reasonLine}\n`;
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
 *
 * Always emits the section so the AI can see whether any tickets were
 * minted; a silently omitted block used to look indistinguishable from
 * a broken assembly pipeline.
 */
const appendRetrievals = (
  text: string,
  retrievals: AssembledRetrieval[] | undefined,
  diagnostics: Pick<ContextAssembleDiagnostics, 'task' | 'project'>,
): string => {
  const header = '### Retrieval Tickets — please report which were used';
  if (retrievals && retrievals.length > 0) {
    const lines = retrievals.map((entry) => {
      const feedback = entry.feedback && (entry.feedback.positive > 0 || entry.feedback.negative > 0)
        ? `  _(feedback so far: +${entry.feedback.positive} / -${entry.feedback.negative})_`
        : '';
      return `- ${entry.origin}: ${entry.nodeId}${feedback}\n  - retrievalId: ${entry.retrievalId}`;
    });
    return `${text}\n\n${header}\nAfter you finish answering, call \`memory_feedback_auto\` once per ticket below with one of \`adopted\` / \`partial\` / \`ignored\` / \`rejected\` so the graph can learn which nodes actually informed your answer.\n${lines.join('\n')}\n`;
  }
  const note = diagnostics.project
    ? `_No retrieval tickets minted. The task \`${diagnostics.task}\` did not select any nodes from project \`${diagnostics.project}\`; either the relevant knowledge has not been ingested yet or the priority selector ranked everything below threshold._`
    : '_No retrieval tickets minted. Supply a `project` argument so the priority selector can pull project-scoped knowledge._';
  return `${text}\n\n${header}\n${note}\n`;
};

export async function handleContextInternalize(
  api: McpApi,
  input: ToolInput,
): Promise<McpToolResponse> {
  assertProjectAllowed(input.project);
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
