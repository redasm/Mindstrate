/**
 * Tests for the Knowledge Extractor
 *
 * Covers: rule-based extraction, commit filtering, language/framework detection
 */

import { describe, it, expect } from 'vitest';
import { KnowledgeExtractor, type CommitInfo } from '../src/capture/extractor.js';
import { KnowledgeType, CaptureSource } from '@mindstrate/protocol';

function makeCommit(overrides: Partial<CommitInfo> = {}): CommitInfo {
  return {
    hash: 'abc1234567890',
    message: 'fix: resolve null pointer in user service',
    diff: `--- a/src/user.ts
+++ b/src/user.ts
@@ -10,6 +10,8 @@
+  if (!user) {
+    throw new Error('User not found');
+  }
+  // Additional safety check
+  const validated = validateUser(user);
   return user.name;`,
    author: 'developer@test.com',
    files: ['src/user.ts', 'src/utils.ts'],
    ...overrides,
  };
}

describe('KnowledgeExtractor', () => {
  const extractor = new KnowledgeExtractor(''); // no API key = rule mode

  describe('extractFromCommit', () => {
    it('should extract from a fix commit', async () => {
      const result = await extractor.extractFromCommit(makeCommit());
      expect(result.extracted).toBe(true);
      expect(result.input).toBeDefined();
      expect(result.input!.type).toBe(KnowledgeType.BUG_FIX);
      expect(result.input!.source).toBe(CaptureSource.GIT_HOOK);
    });

    it('should extract from a feat commit', async () => {
      const result = await extractor.extractFromCommit(
        makeCommit({ message: 'feat: add user authentication flow' })
      );
      expect(result.extracted).toBe(true);
      expect(result.input!.type).toBe(KnowledgeType.PATTERN);
    });

    it('should extract from a refactor commit', async () => {
      const result = await extractor.extractFromCommit(
        makeCommit({ message: 'refactor: simplify database queries' })
      );
      expect(result.extracted).toBe(true);
      expect(result.input!.type).toBe(KnowledgeType.BEST_PRACTICE);
    });

    it('should skip merge commits', async () => {
      const result = await extractor.extractFromCommit(
        makeCommit({ message: 'Merge branch feature/auth into main' })
      );
      expect(result.extracted).toBe(false);
    });

    it('should skip WIP commits', async () => {
      const result = await extractor.extractFromCommit(
        makeCommit({ message: 'wip saving progress' })
      );
      expect(result.extracted).toBe(false);
    });

    it('should skip commits with very small diffs', async () => {
      const result = await extractor.extractFromCommit(
        makeCommit({ diff: '+one line' })
      );
      expect(result.extracted).toBe(false);
    });

    it('should detect typescript from file extensions', async () => {
      const result = await extractor.extractFromCommit(
        makeCommit({ files: ['src/app.ts', 'src/utils.ts'] })
      );
      expect(result.input?.context?.language).toBe('typescript');
    });

    it('should detect python from file extensions', async () => {
      const result = await extractor.extractFromCommit(
        makeCommit({ files: ['main.py', 'utils.py', 'test.py'] })
      );
      expect(result.input?.context?.language).toBe('python');
    });

    it('should detect react framework', async () => {
      const result = await extractor.extractFromCommit(
        makeCommit({
          files: ['src/App.tsx'],
          diff: `+import React from 'react';\n+const App = () => <div>Hello</div>;\n+export default App;\n+// test`,
        })
      );
      expect(result.input?.context?.framework).toBe('react');
    });

    it('should extract tags from conventional commit prefix', async () => {
      const result = await extractor.extractFromCommit(
        makeCommit({ message: 'fix(auth): handle expired tokens' })
      );
      expect(result.input!.tags).toContain('fix');
      expect(result.input!.tags).toContain('auth');
    });

    it('should set low confidence for rule-based extraction', async () => {
      const result = await extractor.extractFromCommit(makeCommit());
      expect(result.input!.confidence).toBe(0.4);
    });
  });
});
