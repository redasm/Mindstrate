/**
 * End-to-end test that the architecture relationship network (project
 * graph file / function / dependency / asset nodes plus IMPORTS / CALLS
 * / DEPENDS_ON edges) actually surfaces during context assembly.
 *
 * Before the assembly selector wiring landed, `assembleContext` only
 * looked at `RULE` / `PATTERN` / `SUMMARY` substrate via
 * `ContextPrioritySelector`, and the project graph nodes
 * (`SNAPSHOT + ARCHITECTURE` carrying `metadata.projectGraph === true`)
 * were silently dropped. The user-visible symptom was:
 *  - Obsidian vault page `<vault>/<project>/architecture/00-overview.md`
 *    plus the per-node pages under `architecture/nodes/` rendered fine,
 *  - but the AI's assembled context never mentioned any of those nodes.
 *
 * This test pins that the assembly now:
 *  1. Returns a `projectGraphContext` array on `AssembledContext`,
 *     seeded by `RetrievalContext.currentFile` and expanded one hop;
 *  2. Renders a `### Project Graph Relationships` section in the
 *     summary, listing `<label> (<kind>) — evidence: <paths>`;
 *  3. Mints a `retrievals[]` array so the AI can close the feedback
 *     loop via `mindstrate_memory_feedback_auto`.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { Mindstrate, detectProject } from '../src/index.js';
import { createTempDir, removeTempDir } from './test-support.js';

describe('assembleContext consumes project graph relationships', () => {
  let projectRoot: string;
  let dataDir: string;
  let memory: Mindstrate;

  beforeEach(async () => {
    projectRoot = createTempDir('mindstrate-assembly-pg-');
    dataDir = createTempDir('mindstrate-assembly-pg-data-');
    memory = new Mindstrate({ dataDir });
    await memory.init();
  });

  afterEach(() => {
    memory.close();
    removeTempDir(projectRoot);
    removeTempDir(dataDir);
  });

  it('surfaces project graph nodes seeded by currentFile and renders a relationships section', async () => {
    fs.writeFileSync(
      path.join(projectRoot, 'package.json'),
      JSON.stringify({ name: 'pg-assembly-demo', dependencies: { react: '^18.0.0' } }),
    );
    fs.mkdirSync(path.join(projectRoot, 'src'), { recursive: true });
    fs.writeFileSync(
      path.join(projectRoot, 'src', 'App.tsx'),
      [
        'import { useState } from "react";',
        'import { format } from "./format";',
        'export function App() {',
        '  const [count] = useState(0);',
        '  return format(count);',
        '}',
      ].join('\n'),
    );
    fs.writeFileSync(
      path.join(projectRoot, 'src', 'format.ts'),
      'export const format = (value: number): string => `count=${value}`;',
    );

    const project = detectProject(projectRoot);
    expect(project).not.toBeNull();
    memory.context.indexProjectGraph(project!);

    const assembled = await memory.assembly.assembleContext(
      'Refactor counter formatting',
      {
        project: 'pg-assembly-demo',
        context: {
          project: 'pg-assembly-demo',
          currentFile: 'src/App.tsx',
          currentLanguage: 'typescript',
          currentFramework: 'react',
        },
      },
    );

    // 1. project graph facts present, including the seed file and at least
    //    one related node reached via 1-hop expansion (the `format`
    //    function or the `./format` dependency or the `react` dep).
    expect(assembled.projectGraphContext).toBeDefined();
    const facts = assembled.projectGraphContext!;
    expect(facts.length).toBeGreaterThan(0);
    expect(facts.some((fact) => fact.source === 'seed' && fact.label.endsWith('App.tsx'))).toBe(true);
    expect(facts.some((fact) => fact.source === 'related')).toBe(true);

    // 2. The summary has a dedicated section that AI prompts can
    //    surface verbatim.
    expect(assembled.summary).toContain('### Project Graph Relationships');
    // The seed App.tsx must appear with its kind in parens.
    expect(assembled.summary).toMatch(/App\.tsx \(file\)/);

    // 3. Every surfaced node got a retrieval ticket so the AI can close
    //    the feedback loop. The set of retrieval node ids must include
    //    every project graph fact id we returned.
    expect(assembled.retrievals).toBeDefined();
    const retrievalNodeIds = new Set(assembled.retrievals!.map((entry) => entry.nodeId));
    for (const fact of facts) expect(retrievalNodeIds.has(fact.nodeId)).toBe(true);
    expect(assembled.retrievals!.some((entry) => entry.origin === 'project-graph')).toBe(true);
  });

  it('falls back to taskDescription token matching when currentFile is not provided', async () => {
    fs.writeFileSync(
      path.join(projectRoot, 'package.json'),
      JSON.stringify({ name: 'pg-token-demo' }),
    );
    fs.mkdirSync(path.join(projectRoot, 'src'), { recursive: true });
    fs.writeFileSync(
      path.join(projectRoot, 'src', 'inventory-service.ts'),
      'export function inventoryService() { return null; }',
    );

    const project = detectProject(projectRoot);
    memory.context.indexProjectGraph(project!);

    const assembled = await memory.assembly.assembleContext(
      'Investigate why inventory-service returns null on cold start',
      { project: 'pg-token-demo' },
    );

    expect(assembled.projectGraphContext).toBeDefined();
    expect(
      assembled.projectGraphContext!.some((fact) => fact.label.includes('inventory-service')),
    ).toBe(true);
  });

  it('omits the relationships section when nothing in the project graph matches', async () => {
    fs.writeFileSync(
      path.join(projectRoot, 'package.json'),
      JSON.stringify({ name: 'pg-empty-demo' }),
    );
    fs.mkdirSync(path.join(projectRoot, 'src'), { recursive: true });
    fs.writeFileSync(path.join(projectRoot, 'src', 'unrelated.ts'), 'export const x = 1;');

    const project = detectProject(projectRoot);
    memory.context.indexProjectGraph(project!);

    const assembled = await memory.assembly.assembleContext(
      'asdfqwer-no-match-token-zxcvbnm',
      { project: 'pg-empty-demo' },
    );

    expect(assembled.projectGraphContext).toBeUndefined();
    expect(assembled.summary).not.toContain('### Project Graph Relationships');
  });
});
