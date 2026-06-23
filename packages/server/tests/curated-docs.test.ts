import { afterEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { ContextNode } from '@mindstrate/protocol/models';
import { collectCuratedProjectDocs } from '../src/project-graph/curated-docs.js';
import { planProjectGraphSystemPagesWithLlm } from '../src/project-graph/system-page-planner.js';
import { resetProjectGraphLlmRequestPolicyForTests } from '../src/project-graph/llm-request-policy.js';
import type { OpenAIClient } from '../src/openai-client.js';
import { createTempDir, removeTempDir } from './test-support.js';

const write = (root: string, rel: string, content: string): void => {
  const abs = path.join(root, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content, 'utf8');
};

const projectFrom = (root: string): never =>
  ({ name: 'curated-demo', root, dependencies: [], entryPoints: [] } as never);

describe('curated project docs collector', () => {
  const temps: string[] = [];
  afterEach(() => {
    while (temps.length) removeTempDir(temps.pop() as string);
  });
  const tmp = (): string => {
    const dir = createTempDir('mindstrate-curated-docs-');
    temps.push(dir);
    return dir;
  };

  it('collects AiAgent docs/instructions as citable evidence with derived titles', () => {
    const root = tmp();
    write(root, 'AiAgent/Docs/camera-system.md', '# Camera System\n\nThe camera uses a spring arm.\n');
    write(root, 'AiAgent/Instructions/core-layer.instructions.md', '## Core Layer Rules\n\nNo UI imports in core.');
    write(root, 'src/App.tsx', 'export const App = () => null;');

    const docs = collectCuratedProjectDocs(projectFrom(root));
    const byPath = new Map(docs.map((d) => [d.path, d]));

    expect(byPath.has('AiAgent/Docs/camera-system.md')).toBe(true);
    expect(byPath.has('AiAgent/Instructions/core-layer.instructions.md')).toBe(true);
    expect(byPath.get('AiAgent/Docs/camera-system.md')?.title).toBe('Camera System');
    expect(byPath.get('AiAgent/Instructions/core-layer.instructions.md')?.title).toBe('Core Layer Rules');
    // Posix-style paths regardless of OS.
    expect(docs.every((d) => !d.path.includes('\\'))).toBe(true);
  });

  it('respects doc count and per-doc char bounds', () => {
    const root = tmp();
    for (let i = 0; i < 5; i++) write(root, `docs/page-${i}.md`, `# Page ${i}\n\n${'x'.repeat(5000)}`);

    const docs = collectCuratedProjectDocs(projectFrom(root), { maxDocs: 2, maxCharsPerDoc: 100 });
    expect(docs).toHaveLength(2);
    expect(docs.every((d) => d.excerpt.length <= 100 + '\n…(truncated)'.length)).toBe(true);
  });

  it('returns empty when no curated doc roots exist', () => {
    const root = tmp();
    write(root, 'src/index.ts', 'export {};');
    expect(collectCuratedProjectDocs(projectFrom(root))).toEqual([]);
  });

  it('grounds the planner: curated doc paths become allowed evidence', async () => {
    resetProjectGraphLlmRequestPolicyForTests();
    const root = tmp();
    write(root, 'AiAgent/Docs/architecture.md', '# Architecture\n\nLayered client.');

    let payload = '';
    const pages = await planProjectGraphSystemPagesWithLlm({
      client: fakeChatClient(JSON.stringify({
        pages: [{
          key: 'architecture',
          fileName: '00-architecture.md',
          title: 'Architecture',
          sections: [{
            heading: 'Overview',
            bullets: [{ text: 'Layered client design.', evidencePaths: ['AiAgent/Docs/architecture.md'] }],
          }],
        }],
      }), (body) => { payload = String(body.messages[1]?.content ?? ''); }),
      model: 'test-model',
      project: projectFrom(root),
      requestPolicy: { requestDelayMs: 0 },
      extractedNodes: [] as ContextNode[],
      curatedDocs: collectCuratedProjectDocs(projectFrom(root)),
    });

    // Planner ran on curated docs alone (no extracted facts) and accepted the
    // curated path as evidence.
    expect(JSON.parse(payload).curatedDocs).toHaveLength(1);
    expect(pages).toHaveLength(1);
    expect(pages?.[0].body.join('\n')).toContain('AiAgent/Docs/architecture.md');
  });
});

const fakeChatClient = (
  content: string,
  onCreate?: (body: { messages: Array<{ content?: string }> }) => void,
): OpenAIClient => ({
  embeddings: { create: async () => ({ data: [] }) },
  chat: {
    completions: {
      create: async (body) => {
        onCreate?.(body as { messages: Array<{ content?: string }> });
        return { choices: [{ message: { content } }] };
      },
    },
  },
});
