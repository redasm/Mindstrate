import type { ParserAdapter, ParserInput, ParserResult, SourceLanguage } from './parser-adapter.js';
import { extractScriptCaptures } from './script-extractor.js';

export const createScriptRegexParserAdapter = (): ParserAdapter => ({
  id: 'script-regex',
  languages: ['typescript', 'tsx', 'javascript', 'jsx', 'python', 'lua', 'csharp'],
  parse(input: ParserInput): ParserResult {
    const language = assertScriptLanguage(input.language);
    return {
      path: input.path,
      language,
      hasErrors: false,
      captures: extractScriptCaptures({
        path: input.path,
        language,
        content: input.content,
      }),
    };
  },
});

const assertScriptLanguage = (language: string): SourceLanguage => {
  if (
    language === 'typescript'
    || language === 'tsx'
    || language === 'javascript'
    || language === 'jsx'
    || language === 'python'
    || language === 'lua'
    || language === 'csharp'
  ) return language;
  throw new Error(`Unsupported script regex language: ${language}`);
};
