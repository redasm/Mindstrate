import type { SourceLanguage } from './parser-adapter.js';

export interface QueryPack {
  id: string;
  languages: SourceLanguage[];
  query: string;
}

// Language-agnostic part of the TS/JS/JSX source query. Node types here exist
// in every ECMAScript grammar (JS, TS, TSX, JSX), so this string compiles
// against all four. Class *name* capture is grammar-specific (TS names classes
// with `type_identifier`, JS with `identifier`), so it lives in the per-flavor
// packs below rather than here.
//
// Coverage note: the original query only had `function_declaration`, which
// missed the dominant TS shapes — class methods (`method_definition`), arrow
// functions assigned to a class field (`public_field_definition`) or a const
// (`variable_declarator`), and `new X()` construction. A codebase written as
// classes (Controller/Model/View) produced almost no symbol nodes and no
// call graph as a result. These captures close that gap.
//
// Class members are captured as `@method.name` (not `@function.name`) on
// purpose: the React-component heuristic derives a `react.component` from every
// uppercase `function.name`, which would otherwise turn an ordinary uppercase
// method (`UpdateNextCustomMarkNumber`) into a bogus COMPONENT node in addition
// to its FUNCTION node. Both `@function.name` and `@method.name` map to a
// FUNCTION symbol downstream, but only `@function.name` feeds the React heuristic.
const sourceQuery = `
  (import_statement source: (string) @import.source)
  (export_statement source: (string) @export.source)
  (function_declaration name: (identifier) @function.name)
  (method_definition name: (property_identifier) @method.name)
  (public_field_definition
    name: (property_identifier) @method.name
    value: [(arrow_function) (function_expression)])
  (variable_declarator
    name: (identifier) @function.name
    value: [(arrow_function) (function_expression)])
  (call_expression function: (identifier) @call.function)
  (call_expression function: (member_expression
    property: (property_identifier) @call.function))
  (new_expression constructor: (identifier) @call.function)
`;

// Class-name capture, split by grammar because the name node type differs:
// TypeScript/TSX use `type_identifier`, JavaScript/JSX use `identifier`.
// `abstract_class_declaration` only exists in the TS grammar.
const tsClassQuery = `
  (class_declaration name: (type_identifier) @class.name)
  (abstract_class_declaration name: (type_identifier) @class.name)
`;

const jsClassQuery = `
  (class_declaration name: (identifier) @class.name)
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
  (call function: (attribute attribute: (identifier) @python.call.method))
`;

const csharpQuery = `
  (using_directive (qualified_name) @script.import)
  (class_declaration name: (identifier) @script.class)
  (method_declaration name: (identifier) @script.function)
  (invocation_expression function: (identifier) @call.function)
  (invocation_expression function: (member_access_expression) @csharp.call.member)
  (invocation_expression function: (member_access_expression name: (identifier) @csharp.call.method))
`;

const luaQuery = `
  (function_declaration name: (identifier) @script.function)
  (function_declaration name: (dot_index_expression field: (identifier) @script.function))
  (function_call name: (identifier) @call.function)
  (function_call name: (dot_index_expression) @lua.call.member)
  (function_call name: (dot_index_expression field: (identifier) @lua.call.method))
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
  (call_expression function: (field_expression field: (field_identifier) @call.function))
`;

export const BUILTIN_TREE_SITTER_QUERY_PACKS: QueryPack[] = [
  {
    id: 'typescript-source',
    languages: ['typescript', 'tsx', 'javascript', 'jsx'],
    query: sourceQuery,
  },
  {
    id: 'typescript-class',
    languages: ['typescript', 'tsx'],
    query: tsClassQuery,
  },
  {
    id: 'javascript-class',
    languages: ['javascript', 'jsx'],
    query: jsClassQuery,
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
