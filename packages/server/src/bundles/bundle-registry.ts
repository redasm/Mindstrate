import type {
  BundlePublicationManifest,
  PublishBundleOptions,
  PublishBundleResult,
} from '@mindstrate/protocol';
import type { PortableContextBundle } from '@mindstrate/protocol/models';
import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';

interface BundleRegistryIndex {
  bundles: BundleRegistryEntry[];
}

interface BundleRegistryEntry extends BundlePublicationManifest {
  bundlePath: string;
}

export interface InstallBundleFromRegistryOptions {
  registry: string;
  reference: string;
}

export const publishBundleToRegistry = (
  bundle: PortableContextBundle,
  options: PublishBundleOptions = {},
): PublishBundleResult => {
  const digest = createHash('sha256')
    .update(JSON.stringify(bundle))
    .digest('hex');

  const manifest: BundlePublicationManifest = {
    id: bundle.id,
    name: bundle.name,
    version: bundle.version,
    registry: options.registry ?? 'local',
    visibility: options.visibility ?? 'unlisted',
    nodeCount: bundle.nodeIds.length,
    edgeCount: bundle.edgeIds.length,
    digest: `sha256:${digest}`,
    publishedAt: new Date().toISOString(),
  };

  if (options.registry && isLocalRegistry(options.registry)) {
    writeBundleToLocalRegistry(options.registry, bundle, manifest);
  }

  return {
    bundle,
    manifest,
  };
};

export const readBundleFromRegistry = async (
  registry: string,
  reference: string,
): Promise<PortableContextBundle> => {
  const index = isLocalRegistry(registry)
    ? readRegistryIndex(registry)
    : await fetchRemoteRegistryIndex(registry);
  const { name, version } = parseBundleReference(reference);
  const candidates = index.bundles.filter((entry) => entry.name === name || entry.id === name);
  const entry = version
    ? candidates.find((item) => item.version === version)
    : candidates.sort((a, b) => compareVersionsDescending(a.version, b.version))[0];

  if (!entry) {
    throw new Error(`Bundle not found in registry: ${reference}`);
  }

  if (isLocalRegistry(registry)) {
    const bundlePath = path.join(registry, entry.bundlePath);
    return JSON.parse(fs.readFileSync(bundlePath, 'utf-8')) as PortableContextBundle;
  }

  return fetchRemoteBundle(registry, entry.bundlePath);
};

const isLocalRegistry = (registry: string): boolean => !/^[a-z][a-z0-9+.-]*:\/\//i.test(registry);

const writeBundleToLocalRegistry = (
  registry: string,
  bundle: PortableContextBundle,
  manifest: BundlePublicationManifest,
): void => {
  const bundleRelativePath = path.join('bundles', bundle.id, bundle.version, 'bundle.json');
  const bundlePath = path.join(registry, bundleRelativePath);
  fs.mkdirSync(path.dirname(bundlePath), { recursive: true });
  fs.writeFileSync(bundlePath, JSON.stringify(bundle, null, 2), 'utf-8');

  const index = readRegistryIndex(registry);
  const entry: BundleRegistryEntry = {
    ...manifest,
    bundlePath: normalizeRegistryPath(bundleRelativePath),
  };
  index.bundles = [
    entry,
    ...index.bundles.filter((item) => !(item.name === entry.name && item.version === entry.version)),
  ];
  fs.mkdirSync(registry, { recursive: true });
  fs.writeFileSync(path.join(registry, 'index.json'), JSON.stringify(index, null, 2), 'utf-8');
};

const readRegistryIndex = (registry: string): BundleRegistryIndex => {
  const indexPath = path.join(registry, 'index.json');
  if (!fs.existsSync(indexPath)) {
    return { bundles: [] };
  }

  const parsed = JSON.parse(fs.readFileSync(indexPath, 'utf-8')) as Partial<BundleRegistryIndex>;
  return {
    bundles: Array.isArray(parsed.bundles) ? parsed.bundles : [],
  };
};

const parseBundleReference = (reference: string): { name: string; version?: string } => {
  const atIndex = reference.lastIndexOf('@');
  if (atIndex <= 0) {
    return { name: reference };
  }
  return {
    name: reference.slice(0, atIndex),
    version: reference.slice(atIndex + 1),
  };
};

const compareVersionsDescending = (a: string, b: string): number =>
  b.localeCompare(a, undefined, { numeric: true, sensitivity: 'base' });

const normalizeRegistryPath = (value: string): string => value.split(path.sep).join('/');

const fetchRemoteRegistryIndex = async (registry: string): Promise<BundleRegistryIndex> => {
  const response = await fetch(new URL('index.json', ensureTrailingSlash(registry)));
  if (!response.ok) {
    throw new Error(`Failed to fetch bundle registry index: ${response.status} ${response.statusText}`);
  }
  const parsed = await response.json() as Partial<BundleRegistryIndex>;
  return {
    bundles: Array.isArray(parsed.bundles) ? parsed.bundles : [],
  };
};

const fetchRemoteBundle = async (registry: string, bundlePath: string): Promise<PortableContextBundle> => {
  const response = await fetch(new URL(bundlePath, ensureTrailingSlash(registry)));
  if (!response.ok) {
    throw new Error(`Failed to fetch bundle: ${response.status} ${response.statusText}`);
  }
  return await response.json() as PortableContextBundle;
};

const ensureTrailingSlash = (value: string): string => value.endsWith('/') ? value : `${value}/`;
