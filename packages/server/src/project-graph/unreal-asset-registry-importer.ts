import * as path from 'node:path';
import { readJsonFile } from '../storage/json-file.js';

export interface UnrealAssetRegistryAsset {
  path: string;
  class?: string;
  parent?: string;
  references?: UnrealAssetRegistryReference[];
}

export interface UnrealAssetRegistryReference {
  path: string;
  type?: 'soft' | 'hard';
}

export interface UnrealAssetRegistryImport {
  assets: UnrealAssetRegistryAsset[];
}

export const UNREAL_ASSET_REGISTRY_EXPORT = '.mindstrate/unreal-asset-registry.json';

export const readUnrealAssetRegistryExport = (projectRoot: string): UnrealAssetRegistryImport | null => {
  const exportPath = path.join(projectRoot, UNREAL_ASSET_REGISTRY_EXPORT);
  const parsed = readJsonFile<unknown>(exportPath);
  if (!parsed || typeof parsed !== 'object' || !Array.isArray((parsed as { assets?: unknown }).assets)) return null;
  return {
    assets: (parsed as { assets: unknown[] }).assets
      .map(normalizeAsset)
      .filter((asset): asset is UnrealAssetRegistryAsset => asset !== null),
  };
};

const normalizeAsset = (value: unknown): UnrealAssetRegistryAsset | null => {
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  if (typeof record.path !== 'string' || !record.path.trim()) return null;
  return {
    path: record.path,
    class: typeof record.class === 'string' ? record.class : undefined,
    parent: typeof record.parent === 'string' ? record.parent : undefined,
    references: normalizeReferences(record),
  };
};

const normalizeReferences = (record: Record<string, unknown>): UnrealAssetRegistryReference[] | undefined => {
  const references = [
    ...referenceArray(record.references),
    ...referenceArray(record.softReferences).map((reference) => ({ ...reference, type: 'soft' as const })),
    ...referenceArray(record.hardReferences).map((reference) => ({ ...reference, type: 'hard' as const })),
  ];
  return references.length > 0 ? uniqueReferences(references) : undefined;
};

const referenceArray = (value: unknown): UnrealAssetRegistryReference[] =>
  Array.isArray(value)
    ? value.flatMap((entry) => {
      if (typeof entry === 'string' && entry.length > 0) return [{ path: entry }];
      if (!entry || typeof entry !== 'object') return [];
      const record = entry as Record<string, unknown>;
      const referenceType = record.type === 'soft' || record.type === 'hard' ? record.type : undefined;
      return typeof record.path === 'string' && record.path.length > 0
        ? [{ path: record.path, type: referenceType }]
        : [];
    })
    : [];

const uniqueReferences = (references: UnrealAssetRegistryReference[]): UnrealAssetRegistryReference[] => {
  const out = new Map<string, UnrealAssetRegistryReference>();
  for (const reference of references) out.set(`${reference.path}:${reference.type ?? ''}`, reference);
  return Array.from(out.values());
};
