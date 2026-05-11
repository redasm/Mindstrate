import { describe, expect, it } from 'vitest';
import { knownSystemPageNames } from '../src/project-graph/obsidian-system-pages.js';
import { enSystemPageDefinitions } from '../src/project-graph/obsidian-system-pages-en.js';
import { zhSystemPageDefinitions } from '../src/project-graph/obsidian-system-pages-zh.js';
import type { DetectedProject } from '../src/project/index.js';

const fakeProject: DetectedProject = {
  name: 'pages-derivation-demo',
  root: '/tmp/never-touched',
  language: 'typescript',
  framework: undefined,
  manifestPath: 'package.json',
  dependencies: [],
  graphHints: { generatedRoots: [] },
};

describe('knownSystemPageNames', () => {
  it('is derived from both locale generators so renames cannot drift out of sync', () => {
    const derived = knownSystemPageNames(fakeProject);
    const fromEn = enSystemPageDefinitions(fakeProject, []).map((page) => page.name);
    const fromZh = zhSystemPageDefinitions(fakeProject, []).map((page) => page.name);

    for (const name of fromEn) expect(derived.has(name)).toBe(true);
    for (const name of fromZh) expect(derived.has(name)).toBe(true);
    expect(derived.size).toBe(new Set([...fromEn, ...fromZh]).size);
  });

  it('produces a non-empty set so the overlay re-import sweep cannot accidentally do nothing', () => {
    expect(knownSystemPageNames(fakeProject).size).toBeGreaterThan(0);
  });
});
