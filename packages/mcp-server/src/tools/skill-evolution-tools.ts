import {
  handleSkillEvolutionEvaluatePatch,
  handleSkillEvolutionGetPatch,
  handleSkillEvolutionListPatches,
  handleSkillEvolutionRejectPatch,
  handleSkillEvolutionRenderBestSkill,
} from './handlers.js';
import {
  SkillEvolutionEvaluatePatchSchema,
  SkillEvolutionGetPatchSchema,
  SkillEvolutionListPatchesSchema,
  SkillEvolutionRejectPatchSchema,
  SkillEvolutionRenderBestSkillSchema,
} from './tool-schemas.js';
import { defineTool } from './tool-types.js';

export const skillEvolutionTools = [
  defineTool({
    name: 'skill_evolution_list_patches',
    description: 'List SkillOpt-style skill evolution candidate patches with their gate status.',
    schema: SkillEvolutionListPatchesSchema,
    handler: (api, input) => handleSkillEvolutionListPatches(api, input),
  }),
  defineTool({
    name: 'skill_evolution_get_patch',
    description: 'Retrieve a single skill evolution patch with its before/after content, budget, and decision metadata.',
    schema: SkillEvolutionGetPatchSchema,
    handler: (api, input) => handleSkillEvolutionGetPatch(api, input),
  }),
  defineTool({
    name: 'skill_evolution_evaluate_patch',
    description: 'Run the validation gate on a candidate skill patch. Only strictly improving candidates are accepted and applied to the source node.',
    schema: SkillEvolutionEvaluatePatchSchema,
    handler: (api, input) => handleSkillEvolutionEvaluatePatch(api, input),
  }),
  defineTool({
    name: 'skill_evolution_reject_patch',
    description: 'Explicitly reject a candidate skill patch with an audited reason without changing the source node.',
    schema: SkillEvolutionRejectPatchSchema,
    handler: (api, input) => handleSkillEvolutionRejectPatch(api, input),
  }),
  defineTool({
    name: 'skill_evolution_render_best_skill',
    description: 'Render the deployable best_skill.md artifact from verified high-quality skill nodes. Read-only projection; does not mutate the graph.',
    schema: SkillEvolutionRenderBestSkillSchema,
    handler: (api, input) => handleSkillEvolutionRenderBestSkill(api, input),
  }),
];
