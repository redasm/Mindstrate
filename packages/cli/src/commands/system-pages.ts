/**
 * `mindstrate system-pages` — manage project-specific architecture pages.
 *
 * Mindstrate ships 8 generic system pages (00-overview ... 07-risky-files).
 * Real projects also have business-system level rules: combat, UI, map,
 * config, asset loading, network, ... Those cannot be generated and
 * have to come from the project itself. This command surface lets a
 * human or an agent author them as JSON files under
 * `<project-root>/.mindstrate/system-pages/`, which Mindstrate loads
 * on every projection write and internalizes into ECS RULE nodes.
 *
 * Sub-commands:
 *   - `mindstrate system-pages list`        — list built-in + custom pages
 *   - `mindstrate system-pages init <key>`  — scaffold a custom page file
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { Command } from 'commander';
import { detectProject, errorMessage } from '@mindstrate/server';

const CUSTOM_DIR = path.join('.mindstrate', 'system-pages');

/**
 * Classification labels the task-report's `classifyTargets` understands.
 * Custom system pages may declare any of these in `metadata.classifications`
 * to be matched when a `before-edit` query hits the same classification.
 * Adding a label here that is NOT in the server-side
 * `SystemPageClassification` union will be silently dropped by the loader,
 * so keep this list aligned with `obsidian-system-page-types.ts`.
 */
const KNOWN_CLASSIFICATIONS = [
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

export const systemPagesCommand = new Command('system-pages')
  .description('Manage project-specific architecture system pages');

systemPagesCommand.command('list')
  .description('List built-in + custom system pages found for this project')
  .option('-C, --cwd <path>', 'Run as if invoked in this directory')
  .action((options) => {
    try {
      const cwd = path.resolve(options.cwd ?? process.cwd());
      const project = detectProject(cwd);
      if (!project) {
        console.error('Could not detect a project at:', cwd);
        process.exit(1);
      }
      const customDir = path.join(project.root, CUSTOM_DIR);
      const customFiles = fs.existsSync(customDir)
        ? fs.readdirSync(customDir).filter((name) => name.toLowerCase().endsWith('.json')).sort()
        : [];
      console.log(`Project: ${project.name}`);
      console.log('Built-in system pages: 00-overview, 01-runtime-lifecycle, 02-cpp-typescript-bridge, 03-plugin-boundaries, 04-generated-files, 05-validation-playbook, 06-common-change-playbooks, 07-risky-files');
      console.log(`Custom pages directory: ${customDir}`);
      if (customFiles.length === 0) {
        console.log('  (no custom pages — drop a .json file in this directory or run `mindstrate system-pages init <key>`)');
      } else {
        for (const file of customFiles) console.log(`  - ${file}`);
      }
    } catch (err) {
      console.error('Failed to list system pages:', errorMessage(err));
      process.exit(1);
    }
  });

systemPagesCommand.command('init <key>')
  .description('Scaffold a project-specific system page (writes a JSON template under .mindstrate/system-pages/)')
  .option('-C, --cwd <path>', 'Run as if invoked in this directory')
  .option('--title <title>', 'Page title (defaults to the key)')
  .option('--force', 'Overwrite the file if it already exists')
  .action((key: string, options) => {
    try {
      const cwd = path.resolve(options.cwd ?? process.cwd());
      const project = detectProject(cwd);
      if (!project) {
        console.error('Could not detect a project at:', cwd);
        process.exit(1);
      }
      if (!isValidKey(key)) {
        console.error(`Invalid key: ${key}. Keys must match /^[a-z0-9_-]+$/i (e.g. "10-combat", "ui").`);
        process.exit(1);
      }
      const dir = path.join(project.root, CUSTOM_DIR);
      const filePath = path.join(dir, `${key}.json`);
      if (fs.existsSync(filePath) && !options.force) {
        console.error(`File already exists: ${filePath}\n  Re-run with --force to overwrite.`);
        process.exit(1);
      }
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(filePath, renderTemplate(key, options.title), 'utf8');
      console.log(`Created system page template: ${filePath}`);
      console.log('');
      console.log('Available metadata.classifications (pick the ones that fit; unknown labels are dropped):');
      for (const value of KNOWN_CLASSIFICATIONS) console.log(`  - ${value}`);
      console.log('');
      console.log('Next steps:');
      console.log('  1. Replace every "TODO" line with project-specific text and pick real classifications.');
      console.log('  2. Run `mindstrate setup` (or `mindstrate graph sync`) to internalize the page into ECS RULE nodes.');
      console.log('  3. Verify recall via `mindstrate graph task before-edit "<your target>"` — your project-specific guidance should appear in the report.');
    } catch (err) {
      console.error('Failed to scaffold system page:', errorMessage(err));
      process.exit(1);
    }
  });

const isValidKey = (key: string): boolean => /^[a-z0-9_-]+$/i.test(key);

const renderTemplate = (key: string, titleOverride?: string): string => {
  const title = titleOverride ?? key;
  const template = {
    _help: {
      schema: 'mindstrate.system-page.v1',
      fillIn: 'Replace every "TODO" line below. Empty arrays are fine — keep the field but leave it [].',
      classificationsHint: `Pick from: ${KNOWN_CLASSIFICATIONS.join(', ')}. Unknown labels are silently dropped.`,
      readMore: 'mindstrate system-pages list — show built-in + custom pages',
    },
    key,
    name: `${key}.md`,
    title,
    body: [
      '## Purpose',
      '',
      `- Project-specific architecture rules for the ${title} subsystem.`,
      '',
      '## Source Of Truth',
      '',
      '- (where the canonical definition lives, e.g. `Source/Combat/Public/*.h` or `Config/DefaultGame.ini`)',
      '',
      '## Editing Rules',
      '',
      '- (what must NOT be edited directly, what must be regenerated, etc.)',
      '',
      '## Verification',
      '',
      '- (how to verify a change works: smoke test, build target, type-gen step, ...)',
    ],
    overlays: [],
    metadata: {
      classifications: [],
      knownConstraints: [
        'TODO: replace with real project-specific constraints (sentence per line).',
      ],
      doNotEditTargets: [
        'TODO: list paths or symbols agents must not edit directly (e.g. generated headers, DataTable rows).',
      ],
      affectedChain: 'TODO: describe the dependency chain (e.g. Source/Combat/*.h -> ASComponent -> Blueprint widgets).',
      sourceOfTruth: [
        'TODO: name the canonical source of truth file/symbol/system.',
      ],
      recommendedVerification: [
        'TODO: list the verification command(s) that must be run after editing.',
      ],
      tags: [key],
    },
  };
  return `${JSON.stringify(template, null, 2)}\n`;
};
