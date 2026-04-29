import {
  handleBundleCreate,
  handleBundleInstall,
  handleBundlePublish,
  handleBundleValidate,
} from './handlers.js';
import {
  BundleCreateSchema,
  BundleInstallSchema,
  BundlePublishSchema,
  BundleValidateSchema,
} from './tool-schemas.js';
import { defineTool } from './tool-types.js';

export const bundleTools = [
  defineTool({
    name: 'bundle_create',
    description: 'Create a portable ECS context bundle from the current graph.',
    schema: BundleCreateSchema,
    handler: (api, input) => handleBundleCreate(api, input),
  }),
  defineTool({
    name: 'bundle_validate',
    description: 'Validate a portable ECS context bundle payload.',
    schema: BundleValidateSchema,
    handler: (api, input) => handleBundleValidate(api, input),
  }),
  defineTool({
    name: 'bundle_install',
    description: 'Install a portable ECS context bundle payload or local registry reference.',
    schema: BundleInstallSchema,
    handler: (api, input) => handleBundleInstall(api, input),
  }),
  defineTool({
    name: 'bundle_publish',
    description: 'Publish or prepare a portable ECS context bundle for distribution.',
    schema: BundlePublishSchema,
    handler: (api, input) => handleBundlePublish(api, input),
  }),
];
