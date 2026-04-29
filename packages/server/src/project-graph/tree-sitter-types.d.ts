declare module 'tree-sitter' {
  type Point = { row: number; column: number };

  class Parser {
    static Query: new (language: unknown, source: string) => Query;
    setLanguage(language: unknown): void;
    parse(input: string): Tree;
  }

  interface Tree {
    rootNode: SyntaxNode;
  }

  interface SyntaxNode {
    type: string;
    text: string;
    startPosition: Point;
    endPosition: Point;
    hasError: boolean;
  }

  interface Query {
    captures(node: SyntaxNode): Array<{ name: string; node: SyntaxNode }>;
  }

  export = Parser;
}

declare module 'tree-sitter-typescript' {
  const grammars: {
    typescript: unknown;
    tsx: unknown;
  };
  export = grammars;
}

declare module 'tree-sitter-javascript' {
  const grammar: unknown;
  export = grammar;
}
