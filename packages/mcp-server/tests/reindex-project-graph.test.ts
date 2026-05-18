/**
 * Regression tests for the reindex_project_graph MCP handler.
 *
 * The handler exists because real-world transcripts showed dbs going
 * stale: an old `mindstrate setup` run misses files that exist on
 * disk today, and there was no in-MCP recovery path — the user had
 * to drop out of the agent loop and run a CLI command. The handler
 * delegates to `McpApi.reindexProjectGraph`, which is wired to
 * `memory.context.indexProjectGraph(detectProject(cwd))` in local
 * mode and rejects in team mode (team server owns its own scan).
 */

import { describe, expect, it } from 'vitest';
import { handleProjectGraphReindex } from '../src/tools/project-graph-handlers.js';
import { createFakeMcpApi } from './fake-mcp-api.js';

describe('handleProjectGraphReindex', () => {
  it('renders the reindex stats when the API call succeeds', async () => {
    const api = createFakeMcpApi({});
    api.reindexProjectGraph = async (input) => {
      expect(input.cwd).toBe('/repo/example');
      return {
        project: 'example',
        filesScanned: 142,
        nodesCreated: 21,
        nodesUpdated: 18,
        edgesCreated: 33,
        edgesUpdated: 7,
        edgesSkipped: 290,
      };
    };

    const response = await handleProjectGraphReindex(api, { cwd: '/repo/example' });

    expect(response.isError).toBeUndefined();
    expect(response.content[0].text).toContain('reindexed for "example"');
    expect(response.content[0].text).toContain('Files scanned:   142');
    expect(response.content[0].text).toContain('Nodes created:   21');
    expect(response.content[0].text).toContain('Edges skipped:   290');
  });

  it('returns isError with a human-readable message when the API rejects (e.g. team mode)', async () => {
    const api = createFakeMcpApi({});
    api.reindexProjectGraph = async () => {
      throw new Error('reindex_project_graph is only available in local mode; the team server owns its own scan cadence.');
    };

    const response = await handleProjectGraphReindex(api, {});

    expect(response.isError).toBe(true);
    expect(response.content[0].text).toContain('local mode');
  });
});
