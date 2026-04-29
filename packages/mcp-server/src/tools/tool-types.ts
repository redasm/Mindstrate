import type { z } from 'zod';
import type { McpApi, McpToolResponse, SessionState } from '../types.js';

export type ToolHandler<Input> = (
  api: McpApi,
  input: Input,
  session: SessionState,
) => Promise<McpToolResponse>;

export interface ToolSpec<Input> {
  name: string;
  description: string;
  schema: z.ZodType<Input>;
  handler: ToolHandler<Input>;
}

export function defineTool<Input>(spec: ToolSpec<Input>): ToolSpec<Input> {
  return spec;
}
