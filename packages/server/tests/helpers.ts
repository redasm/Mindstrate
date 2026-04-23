/**
 * Shared test helpers — create temp directories, in-memory Mindstrate instances, etc.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

/** Create an isolated temp directory for a single test run */
export function createTempDir(prefix = 'mindstrate-test-'): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  return dir;
}

/** Remove temp directory */
export function removeTempDir(dir: string): void {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    // best-effort cleanup
  }
}

import { KnowledgeType, CaptureSource, type CreateKnowledgeInput } from '@mindstrate/protocol';

/** Build a minimal valid knowledge input */
export function makeKnowledgeInput(overrides: Partial<CreateKnowledgeInput> & Record<string, any> = {}): CreateKnowledgeInput {
  return {
    type: KnowledgeType.BUG_FIX,
    title: 'Test knowledge entry',
    problem: 'Something breaks when X happens',
    solution: 'Apply fix Y to resolve the issue completely',
    tags: ['test', 'typescript'],
    context: {
      language: 'typescript',
      framework: 'express',
      project: 'test-project',
    },
    author: 'tester',
    source: CaptureSource.CLI,
    confidence: 0.8,
    ...overrides,
  };
}
