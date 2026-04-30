import type { ParserAdapter, ParserInput, ParserResult, SourceLanguage } from './parser-adapter.js';
import { extractUnrealSourceCaptures } from './unreal-extractor.js';

export const createUnrealCppParserAdapter = (): ParserAdapter => ({
  id: 'unreal-cpp-reflection',
  languages: ['cpp'],
  parse(input: ParserInput): ParserResult {
    return {
      path: input.path,
      language: assertCpp(input.language),
      hasErrors: false,
      captures: extractUnrealSourceCaptures({
        path: input.path,
        content: input.content,
      }).map((capture) => ({ ...capture, extractorId: 'unreal-cpp-reflection' })),
    };
  },
});

const assertCpp = (language: string): SourceLanguage => {
  if (language === 'cpp') return language;
  throw new Error(`Unsupported Unreal C++ parser language: ${language}`);
};
