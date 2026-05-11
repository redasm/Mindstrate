/**
 * Project graph evaluation FIXTURES. Synthetic mini-projects exercised by
 * the evaluation runner to compare legacy-snapshot vs project-graph guidance.
 */

import type { ProjectGraphEvaluationFixture } from './evaluation-dataset-types.js';

export const PROJECT_GRAPH_EVALUATION_FIXTURES: ProjectGraphEvaluationFixture[] = [
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
      requiredEdges: [{ sourceTitle: 'src/App.tsx', targetTitle: 'App', kind: 'defines' }],
      requiredEntryPoints: ['src/main.tsx'],
      requiredReportSnippets: ['Entry Points', 'Core Modules'],
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
      requiredEntryPoints: ['src/main.ts'],
      requiredReportSnippets: ['Entry Points'],
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
      requiredEntryPoints: ['app/page.tsx'],
      requiredReportSnippets: ['Entry Points'],
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
      requiredEntryPoints: ['src/server.ts'],
      requiredReportSnippets: ['Entry Points'],
    },
  },
  {
    id: 'unreal-game',
    label: 'Unreal Game',
    projectName: 'EvalGame',
    description: 'Small Unreal-style fixture with source, config, and content roots.',
    files: {
      'EvalGame.uproject': json({ FileVersion: 3, Modules: [{ Name: 'EvalGame', Type: 'Runtime' }] }),
      '.mindstrate/rules/eval-game.json': json({
        id: 'eval-game',
        name: 'Eval Game',
        priority: 200,
        match: { all: [{ glob: '*.uproject' }] },
        detect: { language: 'cpp', framework: 'unreal-engine', manifest: '*.uproject' },
        sourceRoots: ['Source', 'Config', 'Content'],
        manifests: ['*.uproject'],
      }),
      'Source/EvalGame/EvalGame.Build.cs': 'public class EvalGame : ModuleRules {}',
      'Source/EvalGame/EvalGame.cpp': 'void StartEvalGame() {}',
      'Config/DefaultEngine.ini': '[/Script/EngineSettings.GameMapsSettings]\nGameDefaultMap=/Game/Maps/Main',
      'Content/Maps/Main.umap': '',
    },
    expected: {
      framework: 'unreal-engine',
      minFilesScanned: 4,
      minProjectGraphNodes: 5,
      minProjectGraphEdges: 1,
      requiredNodeTitles: [
        'EvalGame.uproject',
        'Source/EvalGame/EvalGame.Build.cs',
        'Source/EvalGame/EvalGame.cpp',
        'Config/DefaultEngine.ini',
      ],
      requiredEntryPoints: ['EvalGame.uproject'],
      requiredModulePageNames: ['source-evalgame.md'],
      requiredReportSnippets: ['Core Modules'],
    },
  },
  {
    id: 'unreal-mixed-bindings',
    label: 'Unreal Mixed Bindings',
    projectName: 'MixedBindings',
    description: 'UE-style mixed project with C++ reflection, script calls, generated TypeScript bindings, and Asset Registry metadata.',
    files: {
      'MixedBindings.uproject': json({ FileVersion: 3, Modules: [{ Name: 'MixedBindings', Type: 'Runtime' }] }),
      '.mindstrate/rules/mixed-bindings.json': json({
        id: 'mixed-bindings',
        name: 'Mixed Bindings',
        priority: 200,
        match: { all: [{ glob: '*.uproject' }] },
        detect: { language: 'cpp', framework: 'unreal-engine', manifest: '*.uproject' },
        sourceRoots: ['Source', 'Scripts', 'TypeScript/Typing', 'Content'],
        generatedRoots: ['TypeScript/Typing'],
        manifests: ['*.uproject'],
        layers: [{ id: 'assets', label: 'Assets', roots: ['Content'], parserAdapters: ['unreal-asset-metadata'] }],
      }),
      'Source/MixedBindings/Public/InventoryComponent.h': [
        '#pragma once',
        'UCLASS()',
        'class MIXEDBINDINGS_API UInventoryComponent : public UObject {',
        '  GENERATED_BODY()',
        '  UFUNCTION(BlueprintCallable)',
        '  void AddItem();',
        '};',
      ].join('\n'),
      'Scripts/inventory.lua': 'function GiveItem()\n  UE.InventoryComponent()\nend',
      'TypeScript/Typing/UInventoryComponent.ts': 'export declare class UInventoryComponent {}',
      '.mindstrate/unreal-asset-registry.json': json({
        assets: [{ path: '/Game/UI/WBP_Inventory', class: 'WidgetBlueprint', references: ['/Game/Characters/BP_Player'] }],
      }),
      'Content/UI/WBP_Inventory.uasset': '',
    },
    expected: {
      framework: 'unreal-engine',
      minFilesScanned: 4,
      minProjectGraphNodes: 10,
      minProjectGraphEdges: 7,
      requiredNodeTitles: [
        'MixedBindings.uproject',
        'Source/MixedBindings/Public/InventoryComponent.h',
        'Scripts/inventory.lua',
        'TypeScript/Typing/UInventoryComponent.ts',
        'InventoryComponent',
        '/Game/UI/WBP_Inventory',
      ],
      requiredEdges: [
        { sourceTitle: '/Game/UI/WBP_Inventory', targetTitle: '/Game/Characters/BP_Player', kind: 'references_asset' },
        { sourceTitle: 'UInventoryComponent', targetTitle: 'InventoryComponent', kind: 'binds_to' },
      ],
      requiredEntryPoints: ['MixedBindings.uproject'],
      requiredModulePageNames: ['source-mixedbindings.md'],
      requiredReportSnippets: ['Native To Script Bindings', 'Asset And Blueprint Surfaces'],
    },
  },
];


function json(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

