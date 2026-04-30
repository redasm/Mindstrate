import type { ParserCapture } from './parser-adapter.js';

export const extractUnrealSourceCaptures = (input: {
  path: string;
  content: string;
}): ParserCapture[] => [
  ...extractMacroBackedSymbols(input, 'unreal.class', /UCLASS\s*\([^)]*\)[\s\S]*?\bclass\s+(?:\w+_API\s+)?(\w+)/g),
  ...extractMacroBackedSymbols(input, 'unreal.struct', /USTRUCT\s*\([^)]*\)[\s\S]*?\bstruct\s+(?:\w+_API\s+)?(\w+)/g),
  ...extractMacroBackedSymbols(input, 'unreal.enum', /UENUM\s*\([^)]*\)[\s\S]*?\benum\s+(?:class\s+)?(\w+)/g),
  ...extractMacroBackedSymbols(input, 'unreal.function', /UFUNCTION\s*\([^)]*\)[\s\S]*?\n\s*[\w:<>,*&\s]+\s+(\w+)\s*\(/g),
  ...extractMacroBackedSymbols(input, 'unreal.property', /UPROPERTY\s*\([^)]*\)[\s\S]*?\n\s*[\w:<>,*&\s]+\s+(\w+)\s*(?:[;=])/g),
];

export const extractUnrealBuildModuleDependencies = (input: {
  path: string;
  content: string;
}): ParserCapture[] => {
  const captures: ParserCapture[] = [];
  const dependencyBlock = /\b(?:Public|Private)DependencyModuleNames\s*\.\s*AddRange\s*\(\s*new\s+string\s*\[\]\s*\{([\s\S]*?)\}\s*\)/g;
  for (const match of input.content.matchAll(dependencyBlock)) {
    const body = match[1] ?? '';
    const bodyOffset = (match.index ?? 0) + match[0].indexOf(body);
    for (const moduleMatch of body.matchAll(/"([^"]+)"/g)) {
      const text = moduleMatch[1];
      captures.push({
        name: 'unreal.module.dependency',
        text,
        ...lineRangeForIndex(input.content, bodyOffset + (moduleMatch.index ?? 0)),
        path: input.path,
      });
    }
  }
  return captures;
};

const extractMacroBackedSymbols = (
  input: { path: string; content: string },
  name: string,
  regex: RegExp,
): ParserCapture[] =>
  Array.from(input.content.matchAll(regex)).map((match) => ({
    name,
    text: match[1],
    ...lineRangeForIndex(input.content, match.index ?? 0),
    path: input.path,
  }));

const lineRangeForIndex = (content: string, index: number): { startLine: number; endLine: number } => {
  const startLine = content.slice(0, index).split(/\r?\n/).length;
  return { startLine, endLine: startLine };
};
