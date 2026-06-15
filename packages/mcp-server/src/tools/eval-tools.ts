import {
  handleEvalCaseAdd,
  handleEvalCaseDelete,
  handleEvalCaseList,
  handleEvalRun,
} from './handlers.js';
import {
  EvalCaseAddSchema,
  EvalCaseDeleteSchema,
  EvalCaseListSchema,
  EvalRunSchema,
} from './tool-schemas.js';
import { defineTool } from './tool-types.js';

export const evalTools = [
  defineTool({
    name: 'eval_case_list',
    description: 'List retrieval eval dataset cases, optionally filtered by kind (validation / holdout).',
    schema: EvalCaseListSchema,
    handler: (api, input) => handleEvalCaseList(api, input),
  }),
  defineTool({
    name: 'eval_case_add',
    description: 'Add a retrieval eval case (query + expected knowledge ids). Defaults to the validation set used by the skill evolution gate.',
    schema: EvalCaseAddSchema,
    handler: (api, input) => handleEvalCaseAdd(api, input),
  }),
  defineTool({
    name: 'eval_case_delete',
    description: 'Delete a retrieval eval case by id.',
    schema: EvalCaseDeleteSchema,
    handler: (api, input) => handleEvalCaseDelete(api, input),
  }),
  defineTool({
    name: 'eval_run',
    description: 'Run retrieval evaluation over the dataset (optionally scoped to validation or holdout) and report precision/recall/F1/MRR.',
    schema: EvalRunSchema,
    handler: (api, input) => handleEvalRun(api, input),
  }),
];
