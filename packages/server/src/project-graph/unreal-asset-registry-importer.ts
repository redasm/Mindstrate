import * as fs from 'node:fs';
import * as path from 'node:path';

export interface UnrealAssetRegistryAsset {
  path: string;
  class?: string;
  parent?: string;
  references?: string[];
}

export interface UnrealAssetRegistryImport {
  assets: UnrealAssetRegistryAsset[];
}

export const UNREAL_ASSET_REGISTRY_EXPORT = '.mindstrate/unreal-asset-registry.json';

export const readUnrealAssetRegistryExport = (projectRoot: string): UnrealAssetRegistryImport | null => {
  const exportPath = path.join(projectRoot, UNREAL_ASSET_REGISTRY_EXPORT);
  if (!fs.existsSync(exportPath)) return null;
  try {
    const parsed = JSON.parse(fs.readFileSync(exportPath, 'utf8')) as unknown;
    if (!parsed || typeof parsed !== 'object' || !Array.isArray((parsed as { assets?: unknown }).assets)) return null;
    return {
      assets: (parsed as { assets: unknown[] }).assets
        .map(normalizeAsset)
        .filter((asset): asset is UnrealAssetRegistryAsset => asset !== null),
    };
  } catch {
    return null;
  }
};

const normalizeAsset = (value: unknown): UnrealAssetRegistryAsset | null => {
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  if (typeof record.path !== 'string' || !record.path.trim()) return null;
  return {
    path: record.path,
    class: typeof record.class === 'string' ? record.class : undefined,
    parent: typeof record.parent === 'string' ? record.parent : undefined,
    references: Array.isArray(record.references)
      ? record.references.filter((entry): entry is string => typeof entry === 'string' && entry.length > 0)
      : undefined,
  };
};
