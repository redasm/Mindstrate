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

const csharpQuery = `
  (using_directive (qualified_name) @script.import)
  (class_declaration name: (identifier) @script.class)
  (method_declaration name: (identifier) @script.function)
  (invocation_expression function: (identifier) @call.function)
  (invocation_expression function: (member_access_expression) @csharp.call.member)
`;

const luaQuery = `
  (function_declaration name: (identifier) @script.function)
  (function_declaration name: (dot_index_expression field: (identifier) @script.function))
  (function_call name: (identifier) @call.function)
  (function_call name: (dot_index_expression) @lua.call.member)
  (function_call name: (identifier) @lua.require arguments: (arguments (string content: (string_content) @script.import)))
`;

const cppQuery = `
  (preproc_include path: (string_literal) @import.source)
  (class_specifier name: (type_identifier) @class.name)
  (struct_specifier name: (type_identifier) @class.name)
  (function_definition declarator: (function_declarator declarator: (identifier) @function.name))
  (function_definition declarator: (function_declarator declarator: (field_identifier) @function.name))
  (field_declaration declarator: (function_declarator declarator: (field_identifier) @function.name))
  (declaration declarator: (function_declarator declarator: (identifier) @function.name))
  (call_expression function: (identifier) @call.function)
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
  {
    id: 'csharp-source',
    languages: ['csharp'],
    query: csharpQuery,
  },
  {
    id: 'lua-source',
    languages: ['lua'],
    query: luaQuery,
  },
  {
    id: 'cpp-source',
    languages: ['cpp'],
    query: cppQuery,
  },
];

export const queryPacksForLanguage = (language: SourceLanguage): QueryPack[] =>
  BUILTIN_TREE_SITTER_QUERY_PACKS.filter((pack) => pack.languages.includes(language));
