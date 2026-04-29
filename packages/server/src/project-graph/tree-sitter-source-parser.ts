import Parser from 'tree-sitter';
import JavaScript from 'tree-sitter-javascript';
import TypeScript from 'tree-sitter-typescript';
import type {
  ParserAdapter,
  ParserCapture,
  ParserInput,
  ParserResult,
  SourceLanguage,
} from './parser-adapter.js';
import { queryPacksForLanguage } from './query-pack.js';

export const createTreeSitterSourceParser = (): ParserAdapter => new TreeSitterSourceParser();

class TreeSitterSourceParser implements ParserAdapter {
  readonly id = 'tree-sitter-source';
  readonly languages: SourceLanguage[] = ['typescript', 'tsx', 'javascript', 'jsx'];

  parse(input: ParserInput): ParserResult {
    const language = assertSourceLanguage(input.language);
    const parser = new Parser();
    const grammar = grammarForLanguage(language);
    parser.setLanguage(grammar);

    const tree = parser.parse(input.content);
    const captures = queryPacksForLanguage(language).flatMap((pack) => {
      const query = new Parser.Query(grammar, pack.query);
      return query.captures(tree.rootNode).map(({ name, node }) => ({
        name,
        text: node.text,
        startLine: node.startPosition.row + 1,
        endLine: node.endPosition.row + 1,
        path: input.path,
      }));
    });

    return {
      path: input.path,
      language,
      hasErrors: tree.rootNode.hasError,
      captures: addReactDerivedCaptures(captures),
    };
  }
}

const assertSourceLanguage = (language: string): SourceLanguage => {
  if (language === 'typescript' || language === 'tsx' || language === 'javascript' || language === 'jsx') {
    return language;
  }
  throw new Error(`Unsupported tree-sitter language: ${language}`);
};

const grammarForLanguage = (language: SourceLanguage): unknown => {
  if (language === 'typescript') return TypeScript.typescript;
  if (language === 'tsx') return TypeScript.tsx;
  return JavaScript;
};

const addReactDerivedCaptures = (captures: ParserCapture[]): ParserCapture[] => [
  ...captures,
  ...captures
    .filter((capture) => capture.name === 'function.name' && startsWithUppercase(capture.text))
    .map((capture) => ({ ...capture, name: 'react.component' })),
  ...captures
    .filter((capture) => capture.name === 'call.function' && isHookName(capture.text))
    .map((capture) => ({ ...capture, name: 'react.hook' })),
];

const startsWithUppercase = (value: string): boolean => /^[A-Z]/.test(value);
const isHookName = (value: string): boolean => /^use[A-Z0-9]/.test(value);
