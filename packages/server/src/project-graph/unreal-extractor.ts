import type { ParserCapture } from './parser-adapter.js';

export interface UnrealBuildModuleInfo {
  moduleName: string;
  publicDependencies: string[];
  privateDependencies: string[];
}

export interface UnrealManifestModuleInfo {
  name: string;
  type?: string;
  loadingPhase?: string;
}

export interface UnrealManifestPluginDependencyInfo {
  name: string;
  enabled?: boolean;
}

export interface UnrealManifestInfo {
  type: 'project' | 'plugin';
  modules: UnrealManifestModuleInfo[];
  pluginDependencies: UnrealManifestPluginDependencyInfo[];
}

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
  const dependencyBlock = /\b(Public|Private)DependencyModuleNames\s*\.\s*AddRange\s*\(\s*new\s+string\s*\[\]\s*\{([\s\S]*?)\}\s*\)/g;
  for (const match of input.content.matchAll(dependencyBlock)) {
    const scope = (match[1] ?? '').toLowerCase();
    const body = match[2] ?? '';
    const bodyOffset = (match.index ?? 0) + match[0].indexOf(body);
    for (const moduleMatch of body.matchAll(/"([^"]+)"/g)) {
      const text = moduleMatch[1];
      captures.push({
        name: `unreal.module.${scope}-dependency`,
        text,
        ...lineRangeForIndex(input.content, bodyOffset + (moduleMatch.index ?? 0)),
        path: input.path,
        extractorId: 'unreal-build-regex',
      });
    }
  }
  const singleDependency = /\b(Public|Private)DependencyModuleNames\s*\.\s*Add\s*\(\s*"([^"]+)"\s*\)/g;
  for (const match of input.content.matchAll(singleDependency)) {
    const scope = (match[1] ?? '').toLowerCase();
    captures.push({
      name: `unreal.module.${scope}-dependency`,
      text: match[2] ?? '',
      ...lineRangeForIndex(input.content, match.index ?? 0),
      path: input.path,
      extractorId: 'unreal-build-regex',
    });
  }
  return captures;
};

export const extractUnrealConfigReferences = (input: {
  path: string;
  content: string;
}): ParserCapture[] => {
  const captures: ParserCapture[] = [];
  const scriptReference = /\/Script\/([A-Za-z0-9_]+)\.([A-Za-z0-9_]+)/g;
  for (const match of input.content.matchAll(scriptReference)) {
    const index = match.index ?? 0;
    captures.push({
      name: 'unreal.config.module',
      text: match[1] ?? '',
      ...lineRangeForIndex(input.content, index),
      path: input.path,
      extractorId: 'unreal-config-regex',
    });
    captures.push({
      name: 'unreal.config.class',
      text: match[2] ?? '',
      ...lineRangeForIndex(input.content, index),
      path: input.path,
      extractorId: 'unreal-config-regex',
    });
  }
  const pluginReference = /^\s*[+.]?(?:ActivePlugins|EnabledPlugins|Plugins?)\s*=\s*"?([^"\r\n]+)"?\s*$/gm;
  for (const match of input.content.matchAll(pluginReference)) {
    captures.push({
      name: 'unreal.config.plugin',
      text: match[1]?.trim() ?? '',
      ...lineRangeForIndex(input.content, match.index ?? 0),
      path: input.path,
      extractorId: 'unreal-config-regex',
    });
  }
  return captures.filter((capture) => capture.text.length > 0);
};

export const extractUnrealBuildModuleInfo = (input: {
  path: string;
  content: string;
}): UnrealBuildModuleInfo => {
  const classMatch = input.content.match(/\bclass\s+(\w+)\s*:\s*ModuleRules\b/);
  const moduleName = classMatch?.[1] ?? input.path.split(/[\\/]/).pop()?.replace(/\.Build\.cs$/i, '') ?? input.path;
  return {
    moduleName,
    publicDependencies: dependenciesForScope(input.content, 'Public'),
    privateDependencies: dependenciesForScope(input.content, 'Private'),
  };
};

export const extractUnrealManifestInfo = (input: {
  path: string;
  content: string;
}): UnrealManifestInfo | null => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(input.content);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object') return null;
  const record = parsed as Record<string, unknown>;
  return {
    type: input.path.endsWith('.uplugin') ? 'plugin' : 'project',
    modules: arrayRecords(record['Modules']).flatMap((entry) => {
      const name = stringField(entry, 'Name');
      return name ? [{
        name,
        type: stringField(entry, 'Type'),
        loadingPhase: stringField(entry, 'LoadingPhase'),
      }] : [];
    }),
    pluginDependencies: arrayRecords(record['Plugins']).flatMap((entry) => {
      const name = stringField(entry, 'Name');
      return name ? [{
        name,
        enabled: booleanField(entry, 'Enabled'),
      }] : [];
    }),
  };
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

const dependenciesForScope = (content: string, scope: 'Public' | 'Private'): string[] => {
  const values = new Set<string>();
  const addRange = new RegExp(`\\b${scope}DependencyModuleNames\\s*\\.\\s*AddRange\\s*\\(\\s*new\\s+string\\s*\\[\\]\\s*\\{([\\s\\S]*?)\\}\\s*\\)`, 'g');
  for (const match of content.matchAll(addRange)) {
    for (const dependency of stringLiterals(match[1] ?? '')) values.add(dependency);
  }
  const add = new RegExp(`\\b${scope}DependencyModuleNames\\s*\\.\\s*Add\\s*\\(\\s*"([^"]+)"\\s*\\)`, 'g');
  for (const match of content.matchAll(add)) values.add(match[1] ?? '');
  return Array.from(values).filter(Boolean);
};

const stringLiterals = (content: string): string[] =>
  Array.from(content.matchAll(/"([^"]+)"/g)).map((match) => match[1] ?? '').filter(Boolean);

const arrayRecords = (value: unknown): Record<string, unknown>[] =>
  Array.isArray(value) ? value.filter((entry): entry is Record<string, unknown> => !!entry && typeof entry === 'object') : [];

const stringField = (record: Record<string, unknown>, key: string): string | undefined =>
  typeof record[key] === 'string' ? record[key] : undefined;

const booleanField = (record: Record<string, unknown>, key: string): boolean | undefined =>
  typeof record[key] === 'boolean' ? record[key] : undefined;
