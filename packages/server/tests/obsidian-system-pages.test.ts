/**
 * Tests for the layered system page selector.
 *
 * The previous implementation always emitted the Unreal-flavored 8-page
 * book regardless of project type. The new selector layers
 *   skeleton (generic, language-agnostic)
 *   ⊕ stack preset (from the matched detection rule's `systemPagesInclude` file)
 *   ⊕ user pages (`<project>/.mindstrate/system-pages/*.json`)
 * with same-key overrides at each step.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  knownSystemPageNames,
  systemPageDefinitionsForProject,
} from '../src/project-graph/obsidian-system-pages.js';
import { genericSystemPageDefinitions } from '../src/project-graph/obsidian-system-pages-generic.js';
import type { DetectedProject } from '../src/project/index.js';
import { createTempDir, removeTempDir } from './test-support.js';

const baseProject = (overrides: Partial<DetectedProject> = {}): DetectedProject => ({
  name: 'pages-derivation-demo',
  root: '/tmp/never-touched',
  language: 'typescript',
  framework: undefined,
  manifestPath: 'package.json',
  dependencies: [],
  truncatedDeps: 0,
  entryPoints: [],
  scripts: {},
  topDirs: [],
  detectedAt: '',
  ...overrides,
});

describe('systemPageDefinitionsForProject — layered selector', () => {
  it('returns only the generic skeleton when no rule preset and no custom pages exist', () => {
    const project = baseProject();
    const pages = systemPageDefinitionsForProject(project);
    const skeletonKeys = genericSystemPageDefinitions(project).map((page) => page.key);
    expect(pages.map((page) => page.key).sort()).toEqual([...skeletonKeys].sort());
    // Critical: no Unreal-flavored content for a non-Unreal project.
    for (const page of pages) {
      const allText = `${page.title}\n${page.body.join('\n')}`;
      expect(allText.toLowerCase()).not.toContain('uclass');
      expect(allText.toLowerCase()).not.toContain('uplugin');
      expect(allText.toLowerCase()).not.toContain('build.cs');
    }
  });

  it('lets a rule stack preset add stack-specific pages alongside the skeleton', () => {
    const project = baseProject({
      graphHints: {
        generatedRoots: ['Binaries', 'Intermediate'],
        systemPagePresets: {
          en: [
            {
              key: '02-cpp-typescript-bridge',
              name: '02-cpp-typescript-bridge.md',
              title: 'C++ Bridge',
              body: ['## Flow', '', '- C++ UCLASS -> TS.'],
              overlays: ['- kind: convention', '  content: do not edit gen'],
              userNotesPlaceholder: '- Notes',
              userNotesTitle: 'User Notes',
              overlayTitle: 'Structured Overlay',
              metadata: { classifications: ['native-script-binding'] },
            },
          ],
        },
      },
    });

    const pages = systemPageDefinitionsForProject(project);
    const bridgePage = pages.find((page) => page.key === '02-cpp-typescript-bridge');
    expect(bridgePage).toBeDefined();
    expect(bridgePage!.title).toBe('C++ Bridge');
    // Skeleton pages still present (different keys).
    expect(pages.some((page) => page.key === '00-overview')).toBe(true);
    expect(pages.some((page) => page.key === '01-entry-and-scripts')).toBe(true);
  });

  it('lets a rule preset override a skeleton page with the same key', () => {
    const project = baseProject({
      graphHints: {
        systemPagePresets: {
          en: [
            {
              key: '00-overview',
              name: '00-overview.md',
              title: 'Custom Overview',
              body: ['stack-specific overview'],
              overlays: [],
              userNotesPlaceholder: '',
              userNotesTitle: 'User Notes',
              overlayTitle: 'Structured Overlay',
            },
          ],
        },
      },
    });

    const pages = systemPageDefinitionsForProject(project);
    const overview = pages.find((page) => page.key === '00-overview');
    expect(overview).toBeDefined();
    expect(overview!.title).toBe('Custom Overview');
    expect(overview!.body).toEqual(['stack-specific overview']);
  });

  it('falls back to the alternate locale when the preset only ships one', () => {
    const previousLocale = process.env['MINDSTRATE_LOCALE'];
    process.env['MINDSTRATE_LOCALE'] = 'zh';
    try {
      const project = baseProject({
        graphHints: {
          systemPagePresets: {
            en: [
              {
                key: '99-special',
                name: '99-special.md',
                title: 'Stack-only EN page',
                body: ['en-only content'],
                overlays: [],
                userNotesPlaceholder: '',
                userNotesTitle: 'User Notes',
                overlayTitle: 'Structured Overlay',
              },
            ],
          },
        },
      });
      const pages = systemPageDefinitionsForProject(project);
      expect(pages.some((page) => page.key === '99-special')).toBe(true);
    } finally {
      if (previousLocale === undefined) delete process.env['MINDSTRATE_LOCALE'];
      else process.env['MINDSTRATE_LOCALE'] = previousLocale;
    }
  });

  it('lets a custom user page override both skeleton and rule preset for the same key', () => {
    const projectRoot = createTempDir('mindstrate-system-pages-override-');
    try {
      const customDir = path.join(projectRoot, '.mindstrate', 'system-pages');
      fs.mkdirSync(customDir, { recursive: true });
      fs.writeFileSync(
        path.join(customDir, '00-overview.json'),
        JSON.stringify({
          key: '00-overview',
          name: '00-overview.md',
          title: 'User Overview',
          body: ['user-authored content'],
        }),
        'utf8',
      );

      const project = baseProject({
        root: projectRoot,
        graphHints: {
          systemPagePresets: {
            en: [
              {
                key: '00-overview',
                name: '00-overview.md',
                title: 'Stack Overview',
                body: ['stack content'],
                overlays: [],
                userNotesPlaceholder: '',
                userNotesTitle: 'User Notes',
                overlayTitle: 'Structured Overlay',
              },
            ],
          },
        },
      });

      const pages = systemPageDefinitionsForProject(project);
      const overview = pages.find((page) => page.key === '00-overview');
      expect(overview).toBeDefined();
      expect(overview!.title).toBe('User Overview');
    } finally {
      removeTempDir(projectRoot);
    }
  });
});

describe('knownSystemPageNames', () => {
  it('reflects every page name across all three layers', () => {
    const project = baseProject();
    const derived = knownSystemPageNames(project);
    expect(derived.size).toBeGreaterThan(0);
    for (const page of systemPageDefinitionsForProject(project)) {
      expect(derived.has(page.name)).toBe(true);
    }
  });
});
