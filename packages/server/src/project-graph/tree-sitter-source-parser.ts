import Parser from 'tree-sitter';
import CSharp from 'tree-sitter-c-sharp';
import Cpp from 'tree-sitter-cpp';
import JavaScript from 'tree-sitter-javascript';
import Lua from '@tree-sitter-grammars/tree-sitter-lua';
import Python from 'tree-sitter-python';
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
  readonly languages: SourceLanguage[] = ['typescript', 'tsx', 'javascript', 'jsx', 'python', 'lua', 'csharp', 'cpp'];

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
        extractorId: this.id,
      }));
    });

    return {
      path: input.path,
      language,
      hasErrors: tree.rootNode.hasError,
      captures: addDerivedCaptures(language, captures),
    };
  }
}

const assertSourceLanguage = (language: string): SourceLanguage => {
  if (
    language === 'typescript'
    || language === 'tsx'
    || language === 'javascript'
    || language === 'jsx'
    || language === 'python'
    || language === 'lua'
    || language === 'csharp'
    || language === 'cpp'
  ) {
    return language;
  }
  throw new Error(`Unsupported tree-sitter language: ${language}`);
};

const grammarForLanguage = (language: SourceLanguage): unknown => {
  if (language === 'cpp') return Cpp;
  if (language === 'csharp') return CSharp;
  if (language === 'lua') return Lua;
  if (language === 'python') return Python;
  if (language === 'typescript') return TypeScript.typescript;
  if (language === 'tsx') return TypeScript.tsx;
  return JavaScript;
};

const addDerivedCaptures = (language: SourceLanguage, captures: ParserCapture[]): ParserCapture[] => {
  if (language === 'cpp') return addCppDerivedCaptures(captures);
  if (language === 'csharp') return addMemberAccessDerivedCaptures(captures, 'csharp.call.member', 'UE.');
  if (language === 'lua') return addLuaDerivedCaptures(captures);
  if (language === 'python') return addPythonDerivedCaptures(captures);
  return addReactDerivedCaptures(captures);
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

const addPythonDerivedCaptures = (captures: ParserCapture[]): ParserCapture[] => [
  ...addMemberAccessDerivedCaptures(captures, 'python.call.attribute', 'unreal.'),
];

const addLuaDerivedCaptures = (captures: ParserCapture[]): ParserCapture[] => [
  ...addMemberAccessDerivedCaptures(captures, 'lua.call.member', 'UE.')
    .filter((capture) => capture.name !== 'lua.require' && !(capture.name === 'call.function' && capture.text === 'require')),
];

const addCppDerivedCaptures = (captures: ParserCapture[]): ParserCapture[] =>
  captures.filter((capture) => {
    if (capture.name === 'class.name' && capture.text.endsWith('_API')) return false;
    if (capture.name === 'call.function' && UNREAL_REFLECTION_MACROS.has(capture.text)) return false;
    return true;
  });

const addMemberAccessDerivedCaptures = (
  captures: ParserCapture[],
  memberCaptureName: string,
  ueNamespace: string,
): ParserCapture[] => [
  ...captures.filter((capture) => capture.name !== memberCaptureName),
  ...captures
    .filter((capture) => capture.name === memberCaptureName && capture.text.startsWith(ueNamespace))
    .map((capture) => ({
      ...capture,
      name: 'script.ue-call',
      text: capture.text.slice(ueNamespace.length),
    })),
];

const startsWithUppercase = (value: string): boolean => /^[A-Z]/.test(value);
const isHookName = (value: string): boolean => /^use[A-Z0-9]/.test(value);
const UNREAL_REFLECTION_MACROS = new Set(['UCLASS', 'USTRUCT', 'UENUM', 'UFUNCTION', 'UPROPERTY', 'GENERATED_BODY']);
