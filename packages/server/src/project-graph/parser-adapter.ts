export type SourceLanguage =
  | 'typescript'
  | 'tsx'
  | 'javascript'
  | 'jsx'
  | 'cpp'
  | 'csharp'
  | 'python'
  | 'lua';

export interface ParserInput {
  path: string;
  language: string;
  content: string;
}

export interface ParserCapture {
  name: string;
  text: string;
  startLine: number;
  endLine: number;
  path: string;
  extractorId?: string;
}

export interface ParserResult {
  path: string;
  language: SourceLanguage;
  hasErrors: boolean;
  captures: ParserCapture[];
}

export interface ParserAdapter {
  id: string;
  languages: SourceLanguage[];
  parse(input: ParserInput): ParserResult;
}
