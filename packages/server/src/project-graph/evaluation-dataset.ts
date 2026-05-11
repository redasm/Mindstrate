/**
 * Project graph evaluation dataset — barrel that recombines:
 *   - `evaluation-dataset-types.ts` (interfaces, ids)
 *   - `evaluation-fixtures.ts` (synthetic mini-projects)
 *   - `evaluation-tasks.ts` (paired AI prompts)
 *   - `evaluation-runner.ts` (list/get/materialize/evaluate/summarize)
 *   - `evaluation-renderer.ts` (Markdown rendering)
 *
 * Existing consumers continue to import these names through the
 * `project-graph/index.ts` barrel; the implementation just lives in
 * smaller, single-responsibility files now.
 */

export * from './evaluation-dataset-types.js';
export {
  listProjectGraphEvaluationFixtures,
  getProjectGraphEvaluationFixture,
  listProjectGraphEvaluationTasks,
  materializeProjectGraphEvaluationFixture,
  evaluateProjectGraphFixture,
  summarizeProjectGraphEvaluationRuns,
} from './evaluation-runner.js';
export { renderProjectGraphEvaluationDatasetMarkdown } from './evaluation-renderer.js';
