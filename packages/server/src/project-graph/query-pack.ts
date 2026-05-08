import type { SourceLanguage } from './parser-adapter.js';

export interface QueryPack {
  id: string;
  languages: SourceLanguage[];
  query: string;
}

const sourceQuery = `
  (import_statement source: (string) @import.source)
  (function_declaration name: (identifier) @function.name)
  (call_expression function: (identifier) @call.function)
`;

const jsxQuery = `
  (jsx_opening_element name: (identifier) @jsx.component)
  (jsx_self_closing_element name: (identifier) @jsx.component)
`;

const pythonQuery = `
  (import_statement name: (dotted_name) @script.import)
  (import_from_statement module_name: (dotted_name) @script.import)
  (class_definition name: (identifier) @script.class)
  (function_definition name: (identifier) @script.function)
  (call function: (identifier) @call.function)
  (call function: (attribute) @python.call.attribute)
`;

export const BUILTIN_TREE_SITTER_QUERY_PACKS: QueryPack[] = [
  {
    id: 'typescript-source',
    languages: ['typescript', 'tsx', 'javascript', 'jsx'],
    query: sourceQuery,
  },
  {
    id: 'jsx-components',
    languages: ['tsx', 'jsx'],
    query: jsxQuery,
  },
  {
    id: 'python-source',
    languages: ['python'],
    query: pythonQuery,
  },
];

export const queryPacksForLanguage = (language: SourceLanguage): QueryPack[] =>
  BUILTIN_TREE_SITTER_QUERY_PACKS.filter((pack) => pack.languages.includes(language));
