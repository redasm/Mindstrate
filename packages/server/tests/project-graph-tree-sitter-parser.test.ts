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
      expect.objectContaining({ name: 'call.function', text: 'analytics.track', startLine: 7 }),
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
