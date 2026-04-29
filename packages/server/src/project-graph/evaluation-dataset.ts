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

export type ProjectGraphEvaluationMode = 'legacy_snapshot' | 'project_graph';

export interface ProjectGraphEvaluationTask {
  id: string;
  fixtureId: ProjectGraphEvaluationFixtureId;
  mode: 'compare_legacy_snapshot_to_project_graph';
  title: string;
  legacyPrompt: string;
  graphPrompt: string;
  expectedFiles: string[];
  avoidFiles: string[];
  successCriteria: string[];
}

export interface ProjectGraphEvaluationRun {
  taskId: string;
  mode: ProjectGraphEvaluationMode;
  success: boolean;
  filesOpened: string[];
  elapsedMs: number;
  notes?: string;
}

export interface ProjectGraphEvaluationModeMetrics {
  runs: number;
  successRate: number;
  averageFilesOpened: number;
  wrongFilesOpened: number;
  averageTimeToAnswerMs: number;
}

export interface ProjectGraphEvaluationRunSummary {
  totalRuns: number;
  byMode: Record<ProjectGraphEvaluationMode, ProjectGraphEvaluationModeMetrics>;
  comparison: {
    successRateDelta: number;
    averageFilesOpenedDelta: number;
    wrongFilesOpenedDelta: number;
    averageTimeToAnswerMsDelta: number;
  };
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

const TASKS: ProjectGraphEvaluationTask[] = [
  task({
    id: 'react-vite-add-counter-reset',
    fixtureId: 'react-vite',
    title: 'Add a reset action to the React counter.',
    expectedFiles: ['src/App.tsx'],
    avoidFiles: ['dist/main.js', 'node_modules/react/index.js'],
  }),
  task({
    id: 'vue-vite-change-mounted-title',
    fixtureId: 'vue-vite',
    title: 'Change the Vue dashboard title shown by the app component.',
    expectedFiles: ['src/App.vue'],
    avoidFiles: ['dist/assets/index.js', 'node_modules/vue/index.js'],
  }),
  task({
    id: 'next-app-add-settings-link',
    fixtureId: 'next-app',
    title: 'Add a settings navigation link to the Next.js home route.',
    expectedFiles: ['app/page.tsx'],
    avoidFiles: ['app/layout.tsx', '.next/server/app/page.js'],
  }),
  task({
    id: 'node-service-add-readiness-route',
    fixtureId: 'node-service',
    title: 'Add a readiness route to the Node service.',
    expectedFiles: ['src/server.ts'],
    avoidFiles: ['dist/server.js', 'node_modules/express/index.js'],
  }),
  task({
    id: 'unreal-game-adjust-default-map',
    fixtureId: 'unreal-game',
    title: 'Change the Unreal default map setting.',
    expectedFiles: ['Config/DefaultEngine.ini'],
    avoidFiles: ['Intermediate/Build/Manifest.xml', 'Binaries/Win64/EvalGame.exe'],
  }),
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

export const listProjectGraphEvaluationTasks = (): ProjectGraphEvaluationTask[] =>
  TASKS.map((entry) => ({
    ...entry,
    expectedFiles: [...entry.expectedFiles],
    avoidFiles: [...entry.avoidFiles],
    successCriteria: [...entry.successCriteria],
  }));

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

export const summarizeProjectGraphEvaluationRuns = (
  tasks: ProjectGraphEvaluationTask[],
  runs: ProjectGraphEvaluationRun[],
): ProjectGraphEvaluationRunSummary => {
  const taskById = new Map(tasks.map((entry) => [entry.id, entry]));
  const byMode = {
    legacy_snapshot: summarizeMode(taskById, runs.filter((run) => run.mode === 'legacy_snapshot')),
    project_graph: summarizeMode(taskById, runs.filter((run) => run.mode === 'project_graph')),
  };
  return {
    totalRuns: runs.length,
    byMode,
    comparison: {
      successRateDelta: byMode.project_graph.successRate - byMode.legacy_snapshot.successRate,
      averageFilesOpenedDelta: byMode.project_graph.averageFilesOpened - byMode.legacy_snapshot.averageFilesOpened,
      wrongFilesOpenedDelta: byMode.project_graph.wrongFilesOpened - byMode.legacy_snapshot.wrongFilesOpened,
      averageTimeToAnswerMsDelta: byMode.project_graph.averageTimeToAnswerMs - byMode.legacy_snapshot.averageTimeToAnswerMs,
    },
  };
};

const minFailure = (label: string, actual: number, expected: number): string[] =>
  actual >= expected ? [] : [`${label}: expected at least ${expected}, got ${actual}`];

const summarizeMode = (
  taskById: Map<string, ProjectGraphEvaluationTask>,
  runs: ProjectGraphEvaluationRun[],
): ProjectGraphEvaluationModeMetrics => {
  if (runs.length === 0) {
    return {
      runs: 0,
      successRate: 0,
      averageFilesOpened: 0,
      wrongFilesOpened: 0,
      averageTimeToAnswerMs: 0,
    };
  }

  const wrongFilesOpened = runs.reduce((sum, run) => {
    const task = taskById.get(run.taskId);
    if (!task) return sum;
    const opened = new Set(run.filesOpened);
    return sum + task.avoidFiles.filter((file) => opened.has(file)).length;
  }, 0);

  return {
    runs: runs.length,
    successRate: runs.filter((run) => run.success).length / runs.length,
    averageFilesOpened: average(runs.map((run) => run.filesOpened.length)),
    wrongFilesOpened,
    averageTimeToAnswerMs: average(runs.map((run) => run.elapsedMs)),
  };
};

const average = (values: number[]): number =>
  values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length;

function task(input: {
  id: string;
  fixtureId: ProjectGraphEvaluationFixtureId;
  title: string;
  expectedFiles: string[];
  avoidFiles: string[];
}): ProjectGraphEvaluationTask {
  return {
    ...input,
    mode: 'compare_legacy_snapshot_to_project_graph',
    legacyPrompt: [
      'Use only the legacy project snapshot and repository tree.',
      input.title,
      'Record files opened, final edited files, elapsed time, and whether the task succeeded.',
    ].join('\n'),
    graphPrompt: [
      'Query the project graph first, then inspect only the evidence-backed files needed for the task.',
      input.title,
      'Record files opened, final edited files, elapsed time, and whether the task succeeded.',
    ].join('\n'),
    successCriteria: [
      'Task behavior is implemented in the expected source file.',
      'Generated output and dependency directories are not edited.',
      'The answer cites the project graph node or evidence path used to choose files.',
    ],
  };
}

function json(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}
