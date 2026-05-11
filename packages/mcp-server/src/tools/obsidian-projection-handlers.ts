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
  // The materializer returns one of three states:
  //   - changed=true                 -> a new candidate node + event were created (or a
  //                                     plain architecture page was created/updated).
  //   - changed=false + sourceNodeId -> the file was already in sync with an existing
  //                                     ECS node; do not mislead the caller into thinking
  //                                     no node exists for this file.
  //   - changed=false (no id)        -> the file did not match any importable shape.
  if (result.changed) {
    const lines = ['Obsidian projection edit imported.'];
    if (result.sourceNodeId) lines.push(`Source node: ${result.sourceNodeId}`);
    const candidateId = (result.candidateNode as { id?: string } | undefined)?.id;
    if (candidateId) lines.push(`Candidate: ${candidateId}`);
    const eventId = (result.event as { id?: string } | undefined)?.id;
    if (eventId) lines.push(`Event: ${eventId}`);
    return { content: [{ type: 'text', text: lines.join('\n') }] };
  }
  if (result.sourceNodeId) {
    return {
      content: [{
        type: 'text',
        text: [
          'Obsidian projection already in sync with the ECS node.',
          `Source node: ${result.sourceNodeId}`,
          'No new candidate or event was created because the file content matches the stored node exactly.',
        ].join('\n'),
      }],
    };
  }
  return {
    content: [{
      type: 'text',
      text: 'No ECS projection changes imported. The file did not match any importable projection shape.',
    }],
  };
}
