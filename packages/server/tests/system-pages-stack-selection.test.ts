/**
 * Regression: the layered system page selector picks the right
 * stack preset by project type.
 *
 * Pins the user-visible promise that triggered the rewrite: a Node /
 * TypeScript project (like Mindstrate itself) must NOT receive the
 * Unreal-flavored 8-page architecture book, while an Unreal project
 * still does. Without this guarantee `setup` would write
 * `02-cpp-typescript-bridge.md` / `03-plugin-boundaries.md` etc. into
 * a vault that has nothing to do with Unreal.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { detectProject } from '../src/project/detector.js';
import { systemPageDefinitionsForProject } from '../src/project-graph/obsidian-system-pages.js';
import { createTempDir, removeTempDir } from './test-support.js';

const writeFile = (root: string, rel: string, content: string): void => {
  const abs = path.join(root, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content, 'utf8');
};

describe('system page stack selection', () => {
  let projectRoot: string;

  beforeEach(() => {
    projectRoot = createTempDir('mindstrate-stack-selection-');
  });

  afterEach(() => {
    removeTempDir(projectRoot);
  });

  it('emits only the language-agnostic skeleton for a plain Node TypeScript project', () => {
    writeFile(projectRoot, 'package.json', JSON.stringify({ name: 'plain-node-demo' }));
    writeFile(projectRoot, 'src/index.ts', 'export const main = (): void => {};');

    const project = detectProject(projectRoot)!;
    const pages = systemPageDefinitionsForProject(project);
    const keys = pages.map((page) => page.key).sort();
    expect(keys).toEqual(['00-overview', '01-entry-and-scripts', '02-validation-playbook']);
    for (const page of pages) {
      const allText = `${page.title}\n${page.body.join('\n')}`;
      expect(allText.toLowerCase()).not.toContain('uclass');
      expect(allText.toLowerCase()).not.toContain('uplugin');
      expect(allText.toLowerCase()).not.toContain('unrealsharp');
      expect(allText.toLowerCase()).not.toContain('typescript/typing');
    }
  });

  it('emits the Unreal architecture preset for an Unreal project shape', () => {
    writeFile(projectRoot, 'TestGame.uproject', JSON.stringify({ FileVersion: 3 }));
    writeFile(projectRoot, 'Content/.gitkeep', '');
    writeFile(projectRoot, 'Config/.gitkeep', '');
    writeFile(projectRoot, 'Source/TestGame/TestGame.Build.cs', '// stub');

    const project = detectProject(projectRoot)!;
    expect(project.detectionRule?.id).toBe('unreal-project');
    const pages = systemPageDefinitionsForProject(project);
    const keys = new Set(pages.map((page) => page.key));
    for (const expected of [
      '00-overview',
      '01-runtime-lifecycle',
      '02-cpp-typescript-bridge',
      '03-plugin-boundaries',
      '04-generated-files',
      '05-validation-playbook',
      '06-common-change-playbooks',
      '07-risky-files',
    ]) {
      expect(keys, `missing ${expected}`).toContain(expected);
    }
  });

  it('lets a project-local rule override the built-in unreal preset', () => {
    writeFile(projectRoot, 'TestGame.uproject', JSON.stringify({ FileVersion: 3 }));
    writeFile(projectRoot, 'Content/.gitkeep', '');
    writeFile(projectRoot, 'Config/.gitkeep', '');
    writeFile(projectRoot, 'Source/TestGame/TestGame.Build.cs', '// stub');
    writeFile(projectRoot, '.mindstrate/rules/local-unreal.json', JSON.stringify({
      id: 'local-unreal',
      name: 'Local Unreal Override',
      priority: 200,
      systemPagesInclude: 'local-unreal-pages.json',
      match: { all: [{ glob: '*.uproject' }] },
      detect: { language: 'cpp', framework: 'unreal-engine', manifest: '*.uproject' },
    }));
    writeFile(projectRoot, '.mindstrate/rules/local-unreal-pages.json', JSON.stringify({
      en: [
        {
          key: '00-overview',
          name: '00-overview.md',
          title: 'Custom Stack Overview',
          body: ['custom body'],
          overlays: [],
          userNotesPlaceholder: '',
          userNotesTitle: 'User Notes',
          overlayTitle: 'Structured Overlay',
        },
      ],
    }));

    const project = detectProject(projectRoot)!;
    expect(project.detectionRule?.id).toBe('local-unreal');
    const pages = systemPageDefinitionsForProject(project);
    const overview = pages.find((page) => page.key === '00-overview');
    expect(overview?.title).toBe('Custom Stack Overview');
  });
});
