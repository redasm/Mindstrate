import type { ParserCapture } from './parser-adapter.js';

export const extractScriptCaptures = (input: {
  path: string;
  language?: string;
  content: string;
}): ParserCapture[] => {
  if (input.language === 'python') return extractPythonCaptures(input);
  if (input.language === 'lua') return extractLuaCaptures(input);
  if (input.language === 'csharp') return extractCSharpCaptures(input);
  if (input.language === 'typescript' || input.language === 'tsx' || input.language === 'javascript' || input.language === 'jsx') {
    return extractJavaScriptUeCaptures(input);
  }
  return [];
};

const extractPythonCaptures = (input: { path: string; content: string }): ParserCapture[] => [
  ...capturesForRegex(input, 'script.import', /(?:^|\n)\s*(?:from\s+([\w.]+)\s+import|import\s+([\w.]+))/g),
  ...capturesForRegex(input, 'script.class', /(?:^|\n)\s*class\s+(\w+)/g),
  ...capturesForRegex(input, 'script.function', /(?:^|\n)\s*def\s+(\w+)\s*\(/g),
  ...capturesForRegex(input, 'script.ue-call', /\bunreal\.([A-Za-z_]\w*)/g),
];

const extractLuaCaptures = (input: { path: string; content: string }): ParserCapture[] => [
  ...capturesForRegex(input, 'script.import', /\brequire\s*(?:\(\s*)?["']([^"']+)["']/g),
  ...capturesForRegex(input, 'script.function', /(?:^|\n)\s*(?:local\s+)?function\s+([\w.:]+)/g),
  ...capturesForRegex(input, 'script.ue-call', /\bUE\.([A-Za-z_]\w*)/g),
];

const extractCSharpCaptures = (input: { path: string; content: string }): ParserCapture[] => [
  ...capturesForRegex(input, 'script.import', /(?:^|\n)\s*using\s+([\w.]+)\s*;/g),
  ...capturesForRegex(input, 'script.class', /\bclass\s+(\w+)/g),
  ...capturesForRegex(input, 'script.function', /\b(?:public|private|protected|internal|static|\s)+[\w<>\[\]]+\s+(\w+)\s*\(/g),
  ...capturesForRegex(input, 'script.ue-call', /\bUE\.([A-Za-z_]\w*)/g),
];

const extractJavaScriptUeCaptures = (input: { path: string; content: string }): ParserCapture[] => [
  ...capturesForRegex(input, 'script.ue-call', /\bue\.([A-Za-z_]\w*)/gi),
];

const capturesForRegex = (
  input: { path: string; content: string },
  name: string,
  regex: RegExp,
): ParserCapture[] =>
  Array.from(input.content.matchAll(regex))
    .map((match) => match[1] ?? match[2])
    .filter((text): text is string => !!text)
    .map((text) => {
      const index = input.content.indexOf(text);
      return {
        name,
        text,
        ...lineRangeForIndex(input.content, index),
        path: input.path,
        extractorId: 'script-regex',
      };
    });

const lineRangeForIndex = (content: string, index: number): { startLine: number; endLine: number } => {
  const startLine = content.slice(0, Math.max(index, 0)).split(/\r?\n/).length;
  return { startLine, endLine: startLine };
};
