/**
 * Project graph evaluation TASKS. AI prompts pairing each fixture with a
 * legacy-snapshot prompt and a project-graph prompt for A/B comparison.
 */

import type {
  ProjectGraphEvaluationFixtureId,
  ProjectGraphEvaluationTask,
} from './evaluation-dataset-types.js';

export const PROJECT_GRAPH_EVALUATION_TASKS: ProjectGraphEvaluationTask[] = [
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
  task({
    id: 'unreal-mixed-bindings-update-inventory-api',
    fixtureId: 'unreal-mixed-bindings',
    title: 'Trace the inventory API from script usage back to the native C++ declaration.',
    expectedFiles: ['Scripts/inventory.lua', 'Source/MixedBindings/Public/InventoryComponent.h'],
    avoidFiles: ['TypeScript/Typing/UInventoryComponent.ts', 'Intermediate/Build/MixedBindings.generated.cpp'],
  }),
];


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

