/**
 * Regression tests for the memory_add `project` parameter.
 *
 * Before this fix, `memory_add` accepted `language` and `framework`
 * but ignored project scope. Knowledge entries were persisted with a
 * null `project` field, so `graph_knowledge_search({ project })`
 * filtered them out even though `memory_search` (no project filter)
 * could still find them. The fix piping `project` through `context`
 * so it ends up on the ECS node, and on the vector store metadata.
 */

import { describe, expect, it } from 'vitest';
import type { CreateKnowledgeInput } from '@mindstrate/protocol';
import { handleMemoryAdd } from '../src/tools/memory-handlers.js';
import { createFakeMcpApi } from './fake-mcp-api.js';

describe('handleMemoryAdd (project parameter)', () => {
  it('forwards `project` through `context.project` so the graph node is scoped', async () => {
    let captured: CreateKnowledgeInput | undefined;
    const api = createFakeMcpApi({});
    api.add = async (input) => {
      captured = input;
      return {
        success: true,
        view: { id: 'node-1', title: input.title } as never,
        message: 'ok',
      };
    };

    await handleMemoryAdd(api, {
      title: 'Test entry',
      type: 'bug_fix',
      solution: 'do the thing',
      project: 'mindstrate',
      language: 'typescript',
    });

    expect(captured?.context).toMatchObject({
      project: 'mindstrate',
      language: 'typescript',
    });
  });

  it('omits `context.project` when the caller does not pass project (no silent default)', async () => {
    let captured: CreateKnowledgeInput | undefined;
    const api = createFakeMcpApi({});
    api.add = async (input) => {
      captured = input;
      return {
        success: true,
        view: { id: 'node-1', title: input.title } as never,
        message: 'ok',
      };
    };

    await handleMemoryAdd(api, {
      title: 'Test entry',
      type: 'bug_fix',
      solution: 'do the thing',
    });

    expect(captured?.context?.project).toBeUndefined();
  });
});
