/**
 * Tests for `handleObsidianProjectionImport`'s three-way response.
 *
 * The materializer behind the handler returns:
 *   - { changed: true, sourceNodeId, candidateNode, event }   — a real edit
 *   - { changed: false, sourceNodeId }                        — file already in sync
 *   - { changed: false }                                       — file did not match
 *                                                                any importable shape
 *
 * Before the fix the handler collapsed the latter two into a single
 * "No ECS projection changes imported." line, which made users think
 * their architecture-page import had failed. These tests pin the
 * distinction down.
 */

import { describe, expect, it } from 'vitest';
import { handleObsidianProjectionImport } from '../src/tools/obsidian-projection-handlers.js';
import { createFakeMcpApi } from './fake-mcp-api.js';

describe('handleObsidianProjectionImport', () => {
  it('reports a created candidate when the file produces an edit', async () => {
    const api = createFakeMcpApi({
      importObsidianProjectionFileResult: {
        changed: true,
        sourceNodeId: 'rule:source',
        candidateNode: { id: 'rule:candidate' },
        event: { id: 'event:1' },
      },
    });

    const response = await handleObsidianProjectionImport(api, { filePath: '/vault/demo/architecture/00-overview.md' });

    const text = response.content[0].text;
    expect(text).toContain('Obsidian projection edit imported.');
    expect(text).toContain('Source node: rule:source');
    expect(text).toContain('Candidate: rule:candidate');
    expect(text).toContain('Event: event:1');
  });

  it('says the file is already in sync when no candidate was produced but the source node exists', async () => {
    const api = createFakeMcpApi({
      importObsidianProjectionFileResult: {
        changed: false,
        sourceNodeId: 'architecture:system-page:demo:00-overview',
      },
    });

    const response = await handleObsidianProjectionImport(api, { filePath: '/vault/demo/architecture/00-overview.md' });

    const text = response.content[0].text;
    expect(text).toContain('Obsidian projection already in sync with the ECS node.');
    expect(text).toContain('Source node: architecture:system-page:demo:00-overview');
    // Crucially, this is NOT the "no changes imported" message that used
    // to make users think the import failed.
    expect(text).not.toContain('No ECS projection changes imported.');
  });

  it('reports the not-importable branch when neither a candidate nor a source node was produced', async () => {
    const api = createFakeMcpApi({
      importObsidianProjectionFileResult: { changed: false },
    });

    const response = await handleObsidianProjectionImport(api, { filePath: '/vault/random.md' });

    const text = response.content[0].text;
    expect(text).toContain('No ECS projection changes imported.');
    expect(text).toContain('did not match any importable projection shape.');
  });
});
