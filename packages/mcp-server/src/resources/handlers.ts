/**
 * MCP Resource Handlers
 */

import type { McpApi } from '../types.js';

export const RESOURCE_DEFINITIONS = [
  {
    uri: 'memory://stats',
    name: 'Knowledge Base Statistics',
    description: 'Current statistics of the Mindstrate knowledge base',
    mimeType: 'application/json',
  },
];

export async function handleReadResource(
  api: McpApi,
  uri: string,
): Promise<{ uri: string; mimeType: string; text: string }> {
  if (uri === 'memory://stats') {
    const stats = await api.getStats();
    return {
      uri,
      mimeType: 'application/json',
      text: JSON.stringify(stats, null, 2),
    };
  }

  throw new Error(`Unknown resource: ${uri}`);
}
