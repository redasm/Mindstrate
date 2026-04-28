export { createTempDir, removeTempDir } from '../../../tests/support/temp-dir.js';
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
