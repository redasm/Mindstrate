/**
 * Tests for custom (user-supplied) system pages.
 *
 * These pages live under `<project-root>/.mindstrate/system-pages/*.json`
 * and let projects ship business-system level architecture rules
 * (combat / UI / map / config / ...) that the built-in 8 generic pages
 * cannot generate. They are picked up by `systemPageDefinitionsForProject`
 * and internalized into ECS RULE nodes alongside the built-ins.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { detectProject } from '../src/index.js';
import {
  CUSTOM_SYSTEM_PAGES_DIR,
  loadCustomSystemPages,
  mergeSystemPages,
} from '../src/project-graph/custom-system-pages.js';
import { systemPageDefinitionsForProject } from '../src/project-graph/obsidian-system-pages.js';
import { internalizeSystemPagesAsRules, systemPageRuleId } from '../src/project-graph/internalize-system-pages.js';
import { ContextGraphStore } from '../src/context-graph/context-graph-store.js';
import { createTempDir, removeTempDir } from './test-support.js';

let projectRoot: string;
let dbPath: string;

beforeEach(() => {
  projectRoot = createTempDir('mindstrate-custom-system-pages-');
  fs.writeFileSync(path.join(projectRoot, 'package.json'), JSON.stringify({ name: 'custom-pages-demo' }), 'utf8');
  dbPath = path.join(projectRoot, '.mindstrate', 'context-graph.db');
});

afterEach(() => {
  removeTempDir(projectRoot);
});

const writeCustomPage = (key: string, body: Record<string, unknown>): string => {
  const dir = path.join(projectRoot, CUSTOM_SYSTEM_PAGES_DIR);
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${key}.json`);
  fs.writeFileSync(file, JSON.stringify(body, null, 2), 'utf8');
  return file;
};

describe('loadCustomSystemPages', () => {
  it('returns an empty list when the custom directory does not exist', () => {
    const project = detectProject(projectRoot)!;

    expect(loadCustomSystemPages(project)).toEqual([]);
  });

  it('reads valid JSON files into SystemPageDefinition shape', () => {
    writeCustomPage('10-combat', {
      key: '10-combat',
      title: 'Combat System',
      body: ['## Purpose', '', '- combat rules.'],
      metadata: {
        classifications: ['config-sensitive'],
        knownConstraints: ['Damage types are defined in DataTable_DamageTypes.csv; do not hardcode.'],
        doNotEditTargets: ['Source/Combat/Generated/'],
        sourceOfTruth: ['Source/Combat/Public/*.h'],
        recommendedVerification: ['Run combat smoke test in PIE.'],
        tags: ['combat'],
      },
    });
    const project = detectProject(projectRoot)!;

    const pages = loadCustomSystemPages(project);

    expect(pages).toHaveLength(1);
    expect(pages[0]).toMatchObject({
      key: '10-combat',
      name: '10-combat.md',
      title: 'Combat System',
      sourceFile: '10-combat.json',
    });
    expect(pages[0].metadata?.classifications).toEqual(['config-sensitive']);
    expect(pages[0].metadata?.knownConstraints).toEqual(['Damage types are defined in DataTable_DamageTypes.csv; do not hardcode.']);
    expect(pages[0].metadata?.sourceOfTruth).toEqual(['Source/Combat/Public/*.h']);
  });

  it('drops invalid classification labels but keeps the page', () => {
    writeCustomPage('20-ui', {
      key: '20-ui',
      title: 'UI System',
      metadata: {
        classifications: ['ui-system-not-real', 'config-sensitive'],
        knownConstraints: ['UMG widgets are bound to GameplayCue events.'],
      },
    });
    const project = detectProject(projectRoot)!;

    const pages = loadCustomSystemPages(project);

    expect(pages[0].metadata?.classifications).toEqual(['config-sensitive']);
    expect(pages[0].metadata?.knownConstraints).toEqual(['UMG widgets are bound to GameplayCue events.']);
  });

  it('skips files that are not valid JSON or missing the key', () => {
    fs.mkdirSync(path.join(projectRoot, CUSTOM_SYSTEM_PAGES_DIR), { recursive: true });
    fs.writeFileSync(path.join(projectRoot, CUSTOM_SYSTEM_PAGES_DIR, 'broken.json'), 'not json', 'utf8');
    fs.writeFileSync(path.join(projectRoot, CUSTOM_SYSTEM_PAGES_DIR, 'missing-key.json'), JSON.stringify({ title: 'no key' }), 'utf8');
    writeCustomPage('30-network', { key: '30-network', title: 'Network' });
    const project = detectProject(projectRoot)!;

    const pages = loadCustomSystemPages(project);

    expect(pages.map((page) => page.key)).toEqual(['30-network']);
  });

  it('orders results deterministically by key', () => {
    writeCustomPage('30-network', { key: '30-network', title: 'Network' });
    writeCustomPage('10-combat', { key: '10-combat', title: 'Combat' });
    writeCustomPage('20-ui', { key: '20-ui', title: 'UI' });
    const project = detectProject(projectRoot)!;

    const pages = loadCustomSystemPages(project);

    expect(pages.map((page) => page.key)).toEqual(['10-combat', '20-ui', '30-network']);
  });
});

describe('mergeSystemPages', () => {
  it('lets a custom page replace a built-in one with the same key', () => {
    const builtIn = [
      { key: '00-overview', name: '00-overview.md', title: 'Generic Overview', body: [], overlays: [], userNotesPlaceholder: '', userNotesTitle: '', overlayTitle: '' },
      { key: '01-runtime-lifecycle', name: '01-runtime-lifecycle.md', title: 'Runtime Lifecycle', body: [], overlays: [], userNotesPlaceholder: '', userNotesTitle: '', overlayTitle: '' },
    ];
    const custom = [
      { key: '00-overview', name: '00-overview.md', title: 'Project-specific Overview', body: ['custom'], overlays: [], userNotesPlaceholder: '', userNotesTitle: '', overlayTitle: '' },
    ];

    const merged = mergeSystemPages(builtIn, custom);

    expect(merged).toHaveLength(2);
    const overview = merged.find((page) => page.key === '00-overview');
    expect(overview?.title).toBe('Project-specific Overview');
    expect(overview?.body).toEqual(['custom']);
  });

  it('keeps both when keys differ', () => {
    const builtIn = [
      { key: '00-overview', name: '00-overview.md', title: 'Overview', body: [], overlays: [], userNotesPlaceholder: '', userNotesTitle: '', overlayTitle: '' },
    ];
    const custom = [
      { key: '10-combat', name: '10-combat.md', title: 'Combat', body: [], overlays: [], userNotesPlaceholder: '', userNotesTitle: '', overlayTitle: '' },
    ];

    const merged = mergeSystemPages(builtIn, custom);

    expect(merged.map((page) => page.key)).toEqual(['00-overview', '10-combat']);
  });
});

describe('end-to-end: custom pages flow through to internalized RULE nodes', () => {
  it('produces an `architecture:system-page:<project>:<key>` RULE node with the project-specific metadata', () => {
    writeCustomPage('40-asset-loading', {
      key: '40-asset-loading',
      title: 'Asset Loading',
      body: ['## Purpose', '', '- async asset loading via UAssetManager.'],
      metadata: {
        classifications: ['asset-reference-sensitive'],
        knownConstraints: ['All async loads must go through UAssetManager.'],
        sourceOfTruth: ['Source/AssetLoading/Public/AssetLoadingManager.h'],
        recommendedVerification: ['Run async-load smoke test.'],
      },
    });
    const project = detectProject(projectRoot)!;
    const pages = systemPageDefinitionsForProject(project);
    expect(pages.some((page) => page.key === '40-asset-loading')).toBe(true);

    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    const store = new ContextGraphStore(dbPath);
    try {
      internalizeSystemPagesAsRules(store, project, pages);
      const node = store.getNodeById(systemPageRuleId(project.name, '40-asset-loading'));
      expect(node).not.toBeNull();
      expect(node?.metadata?.['classifications']).toEqual(['asset-reference-sensitive']);
      expect(node?.metadata?.['sourceOfTruth']).toEqual(['Source/AssetLoading/Public/AssetLoadingManager.h']);
      expect(node?.metadata?.['systemPage']).toBe(true);
    } finally {
      store.close();
    }
  });

  it('silently ignores unknown top-level fields like the CLI template _help block', () => {
    // The `mindstrate system-pages init` template embeds a `_help`
    // object with hints (schema name, classification list, ...). The
    // loader must accept the file unchanged and ignore the unknown
    // field rather than failing or polluting the page metadata.
    writeCustomPage('50-help', {
      _help: {
        schema: 'mindstrate.system-page',
        classificationsHint: 'pick from: generated-output, build-module, ...',
      },
      key: '50-help',
      title: 'Page With Help Block',
      metadata: { tags: ['help'] },
    });
    const project = detectProject(projectRoot)!;

    const pages = loadCustomSystemPages(project);

    expect(pages).toHaveLength(1);
    expect(pages[0].key).toBe('50-help');
    // _help is not surfaced on the SystemPageDefinition / metadata.
    expect((pages[0] as Record<string, unknown>)._help).toBeUndefined();
    expect(pages[0].metadata?.tags).toEqual(['help']);
  });
});
