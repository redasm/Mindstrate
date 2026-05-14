import { describe, expect, it } from 'vitest';
import { createTreeSitterSourceParser } from '../src/project-graph/tree-sitter-source-parser.js';

describe('tree-sitter source parser', () => {
  it('extracts TSX imports, functions, JSX components, and React hooks', () => {
    const parser = createTreeSitterSourceParser();
    const result = parser.parse({
      path: 'src/App.tsx',
      language: 'tsx',
      content: [
        'import React, { useState } from "react";',
        'import { Button } from "./Button";',
        'export { formatCount } from "./format";',
        '',
        'export function App() {',
        '  const [count, setCount] = useState(0);',
        '  analytics.track(String(count));',
        '  return <Button label={String(count)} />;',
        '}',
      ].join('\n'),
    });

    expect(result.hasErrors).toBe(false);
    expect(result.captures).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'import.source', text: '"react"', startLine: 1 }),
      expect.objectContaining({ name: 'import.source', text: '"./Button"', startLine: 2 }),
      expect.objectContaining({ name: 'export.source', text: '"./format"', startLine: 3 }),
      expect.objectContaining({ name: 'function.name', text: 'App', startLine: 5 }),
      expect.objectContaining({ name: 'react.component', text: 'App', startLine: 5 }),
      expect.objectContaining({ name: 'react.hook', text: 'useState', startLine: 6 }),
      // The TS source query was tightened to capture the leaf
      // `property_identifier` of a member call, so chained calls like
      // `analytics.track(...)` now produce a `call.function: track`
      // capture instead of the full member-expression text. Without
      // that change, dependency node ids on the project graph
      // contained whole chains and overflowed Windows MAX_PATH for
      // any deeply chained CLI builder. See `query-pack.ts`.
      expect.objectContaining({ name: 'call.function', text: 'track', startLine: 7 }),
      expect.objectContaining({ name: 'jsx.component', text: 'Button', startLine: 8 }),
    ]));
  });

  it('rejects unsupported languages before parsing', () => {
    const parser = createTreeSitterSourceParser();

    expect(() => parser.parse({
      path: 'main.rs',
      language: 'rust',
      content: 'fn main() {}',
    })).toThrow(/Unsupported tree-sitter language/);
  });
});
