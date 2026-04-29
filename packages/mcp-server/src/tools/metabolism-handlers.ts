import type { McpApi, McpToolResponse } from '../types.js';

type ToolInput = any;

export async function handleMetabolismRun(
  api: McpApi,
  input: ToolInput,
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
