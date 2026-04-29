import { z } from 'zod';
import { bundleTools } from './bundle-tools.js';
import { contextTools } from './context-tools.js';
import { memoryTools } from './memory-tools.js';
import { metabolismTools } from './metabolism-tools.js';
import { obsidianProjectionTools } from './obsidian-projection-tools.js';
import { sessionTools } from './session-tools.js';

export const toolRegistry = [
  ...memoryTools,
  ...contextTools,
  ...metabolismTools,
  ...obsidianProjectionTools,
  ...bundleTools,
  ...sessionTools,
];

export const toolByName = new Map(toolRegistry.map((tool) => [tool.name, tool]));

export const TOOL_DEFINITIONS = toolRegistry.map((tool) => ({
  name: tool.name,
  description: tool.description,
  inputSchema: z.toJSONSchema(tool.schema) as Record<string, unknown>,
}));
