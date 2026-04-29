import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { ContextDomainType } from '@mindstrate/protocol/models';
import { Mindstrate, detectProject } from '../src/index.js';
import { createTempDir, removeTempDir } from './test-support.js';

const write = (root: string, rel: string, content: string): void => {
  const abs = path.join(root, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content, 'utf8');
};

describe('project graph indexing service', () => {
  let root: string;
  let dataDir: string;
  let memory: Mindstrate;

  beforeEach(async () => {
    root = createTempDir('mindstrate-project-graph-fixture-');
    dataDir = createTempDir('mindstrate-project-graph-data-');
    memory = new Mindstrate({ dataDir });
    await memory.init();
  });

  afterEach(() => {
    memory.close();
    removeTempDir(root);
    removeTempDir(dataDir);
  });

  it('indexes deterministic project graph facts through the context subdomain', () => {
    write(root, 'package.json', JSON.stringify({
      name: 'demo-react',
      dependencies: { react: '^19.0.0' },
    }));
    write(root, 'src/App.tsx', [
      'import React, { useState } from "react";',
      'export function App() {',
      '  const [count] = useState(0);',
      '  return <main>{count}</main>;',
      '}',
    ].join('\n'));

    const project = detectProject(root)!;
    const result = memory.context.indexProjectGraph(project);
    const nodes = memory.context.listContextNodes({
      project: 'demo-react',
      domainType: ContextDomainType.ARCHITECTURE,
      limit: 100,
    });
    const edges = memory.context.listContextEdges({ limit: 100 });

    expect(result.filesScanned).toBe(2);
    expect(result.nodesCreated).toBeGreaterThanOrEqual(4);
    expect(result.edgesCreated).toBeGreaterThanOrEqual(3);
    expect(nodes.some((node) => node.metadata?.['projectGraph'] === true)).toBe(true);
    expect(nodes.map((node) => node.title)).toEqual(expect.arrayContaining([
      'src/App.tsx',
      'App',
      'react',
    ]));
    expect(edges.some((edge) => edge.evidence?.['projectGraph'] === true)).toBe(true);
  });
});
