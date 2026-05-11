/**
 * Project graph evaluation dataset Markdown renderer.
 * Pure formatting: turns fixtures + tasks (+ optional run summary) into a
 * single Markdown report intended for documentation/eval review.
 */

import type {
  ProjectGraphEvaluationFixture,
  ProjectGraphEvaluationRunSummary,
  ProjectGraphEvaluationTask,
  RenderProjectGraphEvaluationDatasetInput,
} from './evaluation-dataset-types.js';

export const renderProjectGraphEvaluationDatasetMarkdown = (
  input: RenderProjectGraphEvaluationDatasetInput,
): string => [
  '# Project Graph Evaluation Dataset',
  '',
  'This dataset compares legacy project snapshot guidance with project graph guided work.',
  '',
  '## Fixtures',
  '',
  ...input.fixtures.flatMap(renderFixtureMarkdown),
  '## AI Task Prompts',
  '',
  ...input.tasks.flatMap(renderTaskMarkdown),
  '## Metrics',
  '',
  '- task success',
  '- files opened',
  '- wrong files opened',
  '- time-to-answer',
  '',
  ...(input.summary ? renderSummaryMarkdown(input.summary) : []),
].join('\n');

const renderFixtureMarkdown = (fixture: ProjectGraphEvaluationFixture): string[] => [
  `### ${fixture.label}`,
  '',
  `- ID: ${fixture.id}`,
  `- Project: ${fixture.projectName}`,
  `- Framework: ${fixture.expected.framework ?? '(none)'}`,
  `- Files: ${Object.keys(fixture.files).join(', ')}`,
  `- Required nodes: ${fixture.expected.requiredNodeTitles.join(', ')}`,
  `- Required edges: ${(fixture.expected.requiredEdges ?? []).map((edge) => `${edge.sourceTitle} -[${edge.kind}]-> ${edge.targetTitle}`).join(', ') || '(none)'}`,
  `- Required entry points: ${(fixture.expected.requiredEntryPoints ?? []).join(', ') || '(none)'}`,
  `- Required module pages: ${(fixture.expected.requiredModulePageNames ?? []).join(', ') || '(none)'}`,
  `- Minimum files scanned: ${fixture.expected.minFilesScanned}`,
  `- Minimum graph nodes: ${fixture.expected.minProjectGraphNodes}`,
  `- Minimum graph edges: ${fixture.expected.minProjectGraphEdges}`,
  '',
  fixture.description,
  '',
];

const renderTaskMarkdown = (task: ProjectGraphEvaluationTask): string[] => [
  `### ${task.title}`,
  '',
  `- ID: ${task.id}`,
  `- Fixture: ${task.fixtureId}`,
  `- Expected files: ${task.expectedFiles.join(', ')}`,
  `- Avoid files: ${task.avoidFiles.join(', ')}`,
  '',
  'Legacy snapshot prompt',
  '',
  '```text',
  task.legacyPrompt,
  '```',
  '',
  'Project graph prompt',
  '',
  '```text',
  task.graphPrompt,
  '```',
  '',
];

const renderSummaryMarkdown = (summary: ProjectGraphEvaluationRunSummary): string[] => [
  '## Latest Run Summary',
  '',
  `- Total runs: ${summary.totalRuns}`,
  `- Success rate delta: ${summary.comparison.successRateDelta}`,
  `- Average files opened delta: ${summary.comparison.averageFilesOpenedDelta}`,
  `- Wrong files opened delta: ${summary.comparison.wrongFilesOpenedDelta}`,
  `- Time-to-answer delta ms: ${summary.comparison.averageTimeToAnswerMsDelta}`,
  '',
];
