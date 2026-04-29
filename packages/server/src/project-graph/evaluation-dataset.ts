import * as fs from 'node:fs';
import * as path from 'node:path';
import type { ContextEdge, ContextNode } from '@mindstrate/protocol/models';
import type { ProjectGraphIndexResult } from './project-graph-service.js';

export type ProjectGraphEvaluationFixtureId =
  | 'react-vite'
  | 'vue-vite'
  | 'next-app'
  | 'node-service'
  | 'unreal-game';

export interface ProjectGraphEvaluationFixture {
  id: ProjectGraphEvaluationFixtureId;
  label: string;
  projectName: string;
  description: string;
  files: Record<string, string>;
  expected: ProjectGraphFixtureExpectations;
}

export interface ProjectGraphFixtureExpectations {
  framework?: string;
  minFilesScanned: number;
  minProjectGraphNodes: number;
  minProjectGraphEdges: number;
  requiredNodeTitles: string[];
}

export interface ProjectGraphFixtureEvaluationInput {
  indexResult: ProjectGraphIndexResult;
  nodes: ContextNode[];
  edges: ContextEdge[];
}

export interface ProjectGraphFixtureEvaluationResult {
  fixtureId: ProjectGraphEvaluationFixtureId;
  passed: boolean;
  failures: string[];
  metrics: ProjectGraphFixtureMetrics;
}

export interface ProjectGraphFixtureMetrics {
  filesScanned: number;
  projectGraphNodes: number;
  projectGraphEdges: number;
}

const FIXTURES: ProjectGraphEvaluationFixture[] = [
  {
    id: 'react-vite',
    label: 'React Vite App',
    projectName: 'eval-react-vite',
    description: 'Small React/Vite app with one browser entry and one component.',
    files: {
      'package.json': json({
        name: 'eval-react-vite',
        type: 'module',
        dependencies: { '@vitejs/plugin-react': '^5.0.0', react: '^19.0.0', vite: '^7.0.0' },
        devDependencies: { typescript: '^5.7.0' },
      }),
      'src/main.tsx': [
        'import React from "react";',
        'import { createRoot } from "react-dom/client";',
        'import { App } from "./App";',
        'createRoot(document.getElementById("root")!).render(<App />);',
      ].join('\n'),
      'src/App.tsx': [
        'import { useState } from "react";',
        'export function App() {',
        '  const [count] = useState(0);',
        '  return <main>{count}</main>;',
        '}',
      ].join('\n'),
    },
    expected: {
      framework: 'react',
      minFilesScanned: 3,
      minProjectGraphNodes: 7,
      minProjectGraphEdges: 4,
      requiredNodeTitles: ['package.json', 'src/App.tsx', 'src/main.tsx', 'react', 'vite', 'App'],
    },
  },
  {
    id: 'vue-vite',
    label: 'Vue Vite App',
    projectName: 'eval-vue-vite',
    description: 'Small Vue app with a Vue SFC and TypeScript entry point.',
    files: {
      'package.json': json({
        name: 'eval-vue-vite',
        type: 'module',
        dependencies: { '@vitejs/plugin-vue': '^6.0.0', vite: '^7.0.0', vue: '^3.5.0' },
        devDependencies: { typescript: '^5.7.0' },
      }),
      'src/main.ts': [
        'import { createApp } from "vue";',
        'import App from "./App.vue";',
        'createApp(App).mount("#app");',
      ].join('\n'),
      'src/App.vue': [
        '<template><main>{{ title }}</main></template>',
        '<script setup lang="ts">',
        'const title = "Dashboard";',
        '</script>',
      ].join('\n'),
    },
    expected: {
      framework: 'vue',
      minFilesScanned: 3,
      minProjectGraphNodes: 7,
      minProjectGraphEdges: 4,
      requiredNodeTitles: ['package.json', 'src/App.vue', 'src/main.ts', 'vue', 'vite'],
    },
  },
  {
    id: 'next-app',
    label: 'Next.js App Router App',
    projectName: 'eval-next-app',
    description: 'Small Next.js App Router project with layout and page entry files.',
    files: {
      'package.json': json({
        name: 'eval-next-app',
        dependencies: { next: '^16.0.0', react: '^19.0.0', 'react-dom': '^19.0.0' },
        devDependencies: { typescript: '^5.7.0' },
      }),
      'app/layout.tsx': [
        'export default function RootLayout({ children }: { children: React.ReactNode }) {',
        '  return <html><body>{children}</body></html>;',
        '}',
      ].join('\n'),
      'app/page.tsx': [
        'import Link from "next/link";',
        'export default function Home() {',
        '  return <main><Link href="/settings">Settings</Link></main>;',
        '}',
      ].join('\n'),
    },
    expected: {
      framework: 'next.js',
      minFilesScanned: 3,
      minProjectGraphNodes: 8,
      minProjectGraphEdges: 5,
      requiredNodeTitles: ['package.json', 'app/layout.tsx', 'app/page.tsx', 'next', 'react', 'Home'],
    },
  },
  {
    id: 'node-service',
    label: 'Node Service',
    projectName: 'eval-node-service',
    description: 'Small TypeScript HTTP service with an explicit server entry.',
    files: {
      'package.json': json({
        name: 'eval-node-service',
        main: 'dist/server.js',
        dependencies: { express: '^5.0.0' },
        devDependencies: { '@types/node': '^25.0.0', typescript: '^5.7.0' },
      }),
      'tsconfig.json': json({ compilerOptions: { module: 'NodeNext', target: 'ES2022' } }),
      'src/server.ts': [
        'import express from "express";',
        'export function createServer() {',
        '  const app = express();',
        '  app.get("/health", (_req, res) => res.json({ ok: true }));',
        '  return app;',
        '}',
      ].join('\n'),
    },
    expected: {
      framework: 'express',
      minFilesScanned: 3,
      minProjectGraphNodes: 7,
      minProjectGraphEdges: 4,
      requiredNodeTitles: ['package.json', 'tsconfig.json', 'src/server.ts', 'express', 'createServer'],
    },
  },
  {
    id: 'unreal-game',
    label: 'Unreal Game',
    projectName: 'EvalGame',
    description: 'Small Unreal-style fixture with source, config, and content roots.',
    files: {
      'EvalGame.uproject': json({ FileVersion: 3, Modules: [{ Name: 'EvalGame', Type: 'Runtime' }] }),
      'Source/EvalGame/EvalGame.Build.cs': 'public class EvalGame : ModuleRules {}',
      'Source/EvalGame/EvalGame.cpp': 'void StartEvalGame() {}',
      'Config/DefaultEngine.ini': '[/Script/EngineSettings.GameMapsSettings]\nGameDefaultMap=/Game/Maps/Main',
      'Content/Maps/Main.umap': '',
    },
    expected: {
      framework: 'unreal-engine',
      minFilesScanned: 5,
      minProjectGraphNodes: 5,
      minProjectGraphEdges: 1,
      requiredNodeTitles: [
        'EvalGame.uproject',
        'Source/EvalGame/EvalGame.Build.cs',
        'Source/EvalGame/EvalGame.cpp',
        'Config/DefaultEngine.ini',
      ],
    },
  },
];

export const listProjectGraphEvaluationFixtures = (): ProjectGraphEvaluationFixture[] =>
  FIXTURES.map((fixture) => ({
    ...fixture,
    files: { ...fixture.files },
    expected: {
      ...fixture.expected,
      requiredNodeTitles: [...fixture.expected.requiredNodeTitles],
    },
  }));

export const getProjectGraphEvaluationFixture = (
  id: ProjectGraphEvaluationFixtureId,
): ProjectGraphEvaluationFixture => {
  const fixture = listProjectGraphEvaluationFixtures().find((candidate) => candidate.id === id);
  if (!fixture) throw new Error(`Unknown project graph evaluation fixture: ${id}`);
  return fixture;
};

export const materializeProjectGraphEvaluationFixture = (
  id: ProjectGraphEvaluationFixtureId,
  root: string,
): ProjectGraphEvaluationFixture => {
  const fixture = getProjectGraphEvaluationFixture(id);
  for (const [rel, content] of Object.entries(fixture.files)) {
    const abs = path.join(root, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content, 'utf8');
  }
  return fixture;
};

export const evaluateProjectGraphFixture = (
  fixture: ProjectGraphEvaluationFixture,
  input: ProjectGraphFixtureEvaluationInput,
): ProjectGraphFixtureEvaluationResult => {
  const projectGraphNodes = input.nodes.filter((node) => node.metadata?.['projectGraph'] === true);
  const projectGraphEdges = input.edges.filter((edge) => edge.evidence?.['projectGraph'] === true);
  const nodeTitles = new Set(projectGraphNodes.map((node) => node.title));
  const failures = [
    ...minFailure('files scanned', input.indexResult.filesScanned, fixture.expected.minFilesScanned),
    ...minFailure('project graph nodes', projectGraphNodes.length, fixture.expected.minProjectGraphNodes),
    ...minFailure('project graph edges', projectGraphEdges.length, fixture.expected.minProjectGraphEdges),
    ...fixture.expected.requiredNodeTitles
      .filter((title) => !nodeTitles.has(title))
      .map((title) => `missing node title: ${title}`),
  ];

  return {
    fixtureId: fixture.id,
    passed: failures.length === 0,
    failures,
    metrics: {
      filesScanned: input.indexResult.filesScanned,
      projectGraphNodes: projectGraphNodes.length,
      projectGraphEdges: projectGraphEdges.length,
    },
  };
};

const minFailure = (label: string, actual: number, expected: number): string[] =>
  actual >= expected ? [] : [`${label}: expected at least ${expected}, got ${actual}`];

function json(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}
