import type {
  SystemPageClassification,
  SystemPageMetadata,
  SystemPageMetadataTriggers,
} from './obsidian-system-page-types.js';

export const KNOWN_SYSTEM_PAGE_CLASSIFICATIONS: SystemPageClassification[] = [
  'generated-output',
  'project-manifest',
  'plugin-manifest',
  'build-module',
  'editor-boundary',
  'asset-reference-sensitive',
  'config-sensitive',
  'native-script-binding',
  'typescript-consumer',
  'cpp-source',
  'general-source',
];

const SYSTEM_PAGE_CLASSIFICATION_SET = new Set<string>(KNOWN_SYSTEM_PAGE_CLASSIFICATIONS);

export const systemPageString = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;

export const systemPageStringArray = (value: unknown): string[] => Array.isArray(value)
  ? value.filter((entry): entry is string => typeof entry === 'string')
  : [];

export const normalizeSystemPageMetadata = (raw: unknown): SystemPageMetadata | undefined => {
  if (!raw || typeof raw !== 'object') return undefined;
  const value = raw as Record<string, unknown>;
  const metadata: SystemPageMetadata = {};
  const classifications = systemPageStringArray(value['classifications'])
    .filter((entry): entry is SystemPageClassification => SYSTEM_PAGE_CLASSIFICATION_SET.has(entry));
  if (classifications.length > 0) metadata.classifications = classifications;
  const triggers = normalizeSystemPageTriggers(value['triggers']);
  if (triggers) metadata.triggers = triggers;
  setStringArray(metadata, 'knownConstraints', value['knownConstraints']);
  setStringArray(metadata, 'doNotEditTargets', value['doNotEditTargets']);
  const affectedChain = systemPageString(value['affectedChain']);
  if (affectedChain) metadata.affectedChain = affectedChain;
  setStringArray(metadata, 'sourceOfTruth', value['sourceOfTruth']);
  setStringArray(metadata, 'recommendedVerification', value['recommendedVerification']);
  setStringArray(metadata, 'tags', value['tags']);
  return Object.keys(metadata).length > 0 ? metadata : undefined;
};

export const normalizeSystemPageTriggers = (raw: unknown): SystemPageMetadataTriggers | undefined => {
  if (!raw || typeof raw !== 'object') return undefined;
  const value = raw as Record<string, unknown>;
  const triggers: SystemPageMetadataTriggers = {};
  setTriggerStringArray(triggers, 'extensions', value['extensions']);
  setTriggerStringArray(triggers, 'pathContains', value['pathContains']);
  setTriggerStringArray(triggers, 'pathSuffix', value['pathSuffix']);
  return hasSystemPageTriggerEntries(triggers) ? triggers : undefined;
};

export const hasSystemPageTriggerEntries = (triggers: SystemPageMetadataTriggers | undefined): boolean => {
  if (!triggers) return false;
  return ((triggers.extensions?.length ?? 0)
    + (triggers.pathContains?.length ?? 0)
    + (triggers.pathSuffix?.length ?? 0)) > 0;
};

export const uniqueSystemPageStrings = (values: string[]): string[] =>
  Array.from(new Set(values.filter(Boolean)));

const setStringArray = <Key extends keyof Pick<
  SystemPageMetadata,
  'knownConstraints' | 'doNotEditTargets' | 'sourceOfTruth' | 'recommendedVerification' | 'tags'
>>(
  metadata: SystemPageMetadata,
  key: Key,
  raw: unknown,
): void => {
  const values = systemPageStringArray(raw);
  if (values.length > 0) metadata[key] = values;
};

const setTriggerStringArray = <Key extends keyof SystemPageMetadataTriggers>(
  triggers: SystemPageMetadataTriggers,
  key: Key,
  raw: unknown,
): void => {
  const values = systemPageStringArray(raw);
  if (values.length > 0) triggers[key] = values;
};
