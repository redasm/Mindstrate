import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  ContextDomainType,
  ContextNodeStatus,
  ProjectGraphNodeKind,
  ProjectGraphProvenance,
  SubstrateType,
  type ContextNode,
} from '@mindstrate/protocol/models';
import { Mindstrate, detectProject } from '../src/index.js';
import type { OpenAIClient } from '../src/openai-client.js';
import { resetProjectGraphLlmRequestPolicyForTests } from '../src/project-graph/llm-request-policy.js';
import { planProjectGraphSystemPagesWithLlm } from '../src/project-graph/system-page-planner.js';
import { createTempDir, removeTempDir } from './test-support.js';

const write = (root: string, rel: string, content: string): void => {
  const abs = path.join(root, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content, 'utf8');
};

describe('project graph LLM system page planner', () => {
  let previousLocale: string | undefined;

  beforeEach(() => {
    resetProjectGraphLlmRequestPolicyForTests();
    previousLocale = process.env['MINDSTRATE_LOCALE'];
    process.env['MINDSTRATE_LOCALE'] = 'en';
  });

  afterEach(() => {
    if (previousLocale === undefined) {
      delete process.env['MINDSTRATE_LOCALE'];
    } else {
      process.env['MINDSTRATE_LOCALE'] = previousLocale;
    }
  });

  it('renders evidence-backed Chinese pages from a bounded LLM plan', async () => {
    process.env['MINDSTRATE_LOCALE'] = 'zh-CN';
    const pages = await planProjectGraphSystemPagesWithLlm({
      client: fakeChatClient(JSON.stringify({
        pages: [{
          key: 'runtime-entrypoints',
          fileName: '00-运行入口.md',
          title: '运行入口',
          sections: [{
            heading: '入口文件',
            bullets: [{
              text: 'App.tsx 是运行时入口。',
              evidencePaths: ['src/App.tsx', 'src/missing.ts'],
            }],
          }],
          defaultOverlays: [{
            kind: 'risk',
            target: 'src/App.tsx',
            content: '入口文件修改前需要查询影响面。',
          }],
        }],
      })),
      model: 'test-model',
      project: { name: 'planner-demo', root: process.cwd(), dependencies: [], entryPoints: [] } as never,
      requestPolicy: { requestDelayMs: 0 },
      extractedNodes: [projectGraphNode('src/App.tsx')],
    });

    expect(pages).toHaveLength(1);
    expect(pages?.[0]).toMatchObject({
      key: 'runtime-entrypoints',
      name: '00-运行入口.md',
      title: '运行入口',
      userNotesTitle: '用户笔记',
      overlayTitle: '结构化 Overlay',
    });
    expect(pages?.[0].body.join('\n')).toContain('证据: src/App.tsx');
    expect(pages?.[0].body.join('\n')).not.toContain('src/missing.ts');
    expect(pages?.[0].overlays.join('\n')).toContain('kind: risk');
  });

  it('falls back when the LLM returns invalid or unsafe plans', async () => {
    await expect(planProjectGraphSystemPagesWithLlm({
      client: fakeChatClient('not json'),
      model: 'test-model',
      project: { name: 'planner-demo', root: process.cwd(), dependencies: [], entryPoints: [] } as never,
      requestPolicy: { requestDelayMs: 0 },
      extractedNodes: [projectGraphNode('src/App.tsx')],
    })).resolves.toBeNull();

    await expect(planProjectGraphSystemPagesWithLlm({
      client: fakeChatClient(JSON.stringify({
        pages: [{
          key: 'unsafe',
          fileName: '../unsafe.md',
          title: 'Unsafe',
          sections: [{ heading: 'Unsafe', bullets: [{ text: 'This should be filtered.', evidencePaths: ['src/App.tsx'] }] }],
        }],
      })),
      model: 'test-model',
      project: { name: 'planner-demo', root: process.cwd(), dependencies: [], entryPoints: [] } as never,
      requestPolicy: { requestDelayMs: 0 },
      extractedNodes: [projectGraphNode('src/App.tsx')],
    })).resolves.toBeNull();
  });

  it('uses request policy to bound system page payloads and timeout', async () => {
    let payload = '';
    let timeout: number | undefined;

    await planProjectGraphSystemPagesWithLlm({
      client: fakeChatClient(JSON.stringify({ pages: [] }), (body, options) => {
        payload = String(body.messages[1]?.content ?? '');
        timeout = options?.timeout;
      }),
      model: 'test-model',
      project: { name: 'planner-demo', root: process.cwd(), dependencies: [], entryPoints: [] } as never,
      requestPolicy: { factBatchSize: 10, requestDelayMs: 0, requestTimeoutMs: 30000 },
      extractedNodes: Array.from({ length: 30 }, (_, index) => projectGraphNode(`src/file-${index}.ts`)),
    });

    expect(JSON.parse(payload).facts).toHaveLength(10);
    expect(timeout).toBe(30000);
  });

  it('writes planned pages through the Obsidian projection fallback boundary', async () => {
    const root = createTempDir('mindstrate-project-graph-planned-pages-');
    const dataDir = createTempDir('mindstrate-project-graph-planned-pages-data-');
    const vaultRoot = createTempDir('mindstrate-project-graph-planned-pages-vault-');
    const memory = new Mindstrate({ dataDir });
    try {
      await memory.init();
      write(root, 'package.json', JSON.stringify({ name: 'planned-pages-demo' }));
      write(root, 'src/App.tsx', 'export function App() { return <main />; }');
      const project = detectProject(root)!;
      memory.context.indexProjectGraph(project);

      memory.context.writeProjectGraphObsidianProjection(project, vaultRoot, {
        systemPages: [{
          key: 'runtime-entrypoints',
          name: '00-runtime-entrypoints.md',
          title: 'Runtime Entrypoints',
          body: ['## Entrypoints', '', '- App.tsx owns the runtime entry. Evidence: src/App.tsx'],
          overlays: ['- kind: risk', '  target: src/App.tsx', '  content: Review impact before changing the entrypoint.'],
          userNotesPlaceholder: '- Add project-specific confirmations, corrections, or open questions here.',
          userNotesTitle: 'User Notes',
          overlayTitle: 'Structured Overlay',
        }],
      });

      const pagePath = path.join(vaultRoot, 'planned-pages-demo', 'architecture', '00-runtime-entrypoints.md');
      expect(fs.existsSync(pagePath)).toBe(true);
      expect(fs.readFileSync(pagePath, 'utf8')).toContain('# Runtime Entrypoints');
      const projectionIndex = JSON.parse(fs.readFileSync(path.join(vaultRoot, '_meta', 'index.json'), 'utf8')) as {
        projectGraphPages: Record<string, { path: string }>;
      };
      expect(projectionIndex.projectGraphPages['planned-pages-demo:system:runtime-entrypoints']).toMatchObject({
        path: 'planned-pages-demo/architecture/00-runtime-entrypoints.md',
      });
      expect(fs.existsSync(path.join(vaultRoot, 'planned-pages-demo', 'architecture', '00-overview.md'))).toBe(false);
    } finally {
      memory.close();
      removeTempDir(root);
      removeTempDir(dataDir);
      removeTempDir(vaultRoot);
    }
  });
});

const projectGraphNode = (filePath: string): ContextNode => ({
  id: `pg:demo:file:${filePath}`,
  substrateType: SubstrateType.SNAPSHOT,
  domainType: ContextDomainType.ARCHITECTURE,
  title: filePath,
  content: `file: ${filePath}`,
  tags: ['project-graph', 'file'],
  project: 'demo',
  compressionLevel: 1,
  confidence: 1,
  qualityScore: 80,
  positiveFeedback: 0,
  negativeFeedback: 0,
  accessCount: 0,
  status: ContextNodeStatus.ACTIVE,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  sourceRef: filePath,
  metadata: {
    projectGraph: true,
    kind: ProjectGraphNodeKind.FILE,
    provenance: ProjectGraphProvenance.EXTRACTED,
    evidence: [{ path: filePath, extractorId: 'project-graph-scanner' }],
  },
});

const fakeChatClient = (
  content: string,
  onCreate?: (body: { messages: Array<{ content?: string }> }, options?: { timeout?: number }) => void,
): OpenAIClient => ({
  embeddings: {
    create: async () => ({ data: [] }),
  },
  chat: {
    completions: {
      create: async (body, options) => {
        onCreate?.(body as { messages: Array<{ content?: string }> }, options as { timeout?: number });
        return { choices: [{ message: { content } }] };
      },
    },
  },
});
