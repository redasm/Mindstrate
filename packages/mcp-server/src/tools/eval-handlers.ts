import type { McpApi, McpToolResponse } from '../types.js';
import type { EvalCaseKind } from '@mindstrate/protocol';

type ToolInput = any;

export async function handleEvalCaseList(api: McpApi, input: ToolInput): Promise<McpToolResponse> {
  const cases = await api.listEvalCases({ kind: input.kind as EvalCaseKind | undefined });
  if (cases.length === 0) {
    return { content: [{ type: 'text', text: 'No eval cases found.' }] };
  }
  const lines = cases.map((c) => `- [${c.kind}] ${c.query} -> ${c.expectedIds.join(', ')} (${c.id})`);
  return { content: [{ type: 'text', text: `Eval cases (${cases.length}):\n${lines.join('\n')}` }] };
}

export async function handleEvalCaseAdd(api: McpApi, input: ToolInput): Promise<McpToolResponse> {
  const created = await api.addEvalCase({
    query: input.query,
    expectedIds: input.expectedIds,
    language: input.language,
    framework: input.framework,
    kind: input.kind as EvalCaseKind | undefined,
  });
  return { content: [{ type: 'text', text: `Added ${created.kind} eval case ${created.id}.` }] };
}

export async function handleEvalCaseDelete(api: McpApi, input: ToolInput): Promise<McpToolResponse> {
  const result = await api.deleteEvalCase(input.id);
  return {
    content: [{ type: 'text', text: result.deleted ? `Deleted eval case ${input.id}.` : `Eval case not found: ${input.id}` }],
    isError: !result.deleted,
  };
}

export async function handleEvalRun(api: McpApi, input: ToolInput): Promise<McpToolResponse> {
  const run = await api.runEvalDataset({ topK: input.topK, kind: input.kind as EvalCaseKind | undefined });
  return {
    content: [{
      type: 'text',
      text: [
        `Eval run over ${run.totalCases} case(s)${input.kind ? ` (${input.kind})` : ''}.`,
        `Precision: ${run.precision.toFixed(3)}`,
        `Recall: ${run.recall.toFixed(3)}`,
        `F1: ${run.f1.toFixed(3)}`,
        `MRR: ${run.meanReciprocalRank.toFixed(3)}`,
      ].join('\n'),
    }],
  };
}
