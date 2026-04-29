import type { McpApi, McpToolResponse } from '../types.js';

type ToolInput = any;

export async function handleObsidianProjectionWrite(
  api: McpApi,
  input: ToolInput,
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
  input: ToolInput,
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
