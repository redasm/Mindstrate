import type { TeamClient } from '@mindstrate/client';
import type { LocalMemory, McpApi } from './types.js';

type BundleProjectionApi = Pick<
  McpApi,
  | 'createBundle'
  | 'validateBundle'
  | 'installBundle'
  | 'installBundleFromRegistry'
  | 'publishBundle'
  | 'generateInternalizationSuggestions'
  | 'acceptInternalizationSuggestions'
  | 'writeObsidianProjectionFiles'
  | 'importObsidianProjectionFile'
>;

export function createBundleProjectionApi(
  teamClient: TeamClient | null,
  getMemory: () => LocalMemory,
): BundleProjectionApi {
  return {
    async createBundle(options) {
      if (teamClient) return teamClient.bundles.create(options);
      return getMemory().bundles.createBundle(options);
    },
    async validateBundle(bundle) {
      if (teamClient) return teamClient.bundles.validate(bundle);
      return getMemory().bundles.validateBundle(bundle);
    },
    async installBundle(bundle) {
      if (teamClient) return teamClient.bundles.install(bundle);
      return getMemory().bundles.installBundle(bundle);
    },
    async installBundleFromRegistry(options) {
      if (teamClient) return teamClient.bundles.installFromRegistry(options);
      return getMemory().bundles.installBundleFromRegistry(options);
    },
    async publishBundle(bundle, options) {
      if (teamClient) return teamClient.bundles.publish(bundle, options);
      return getMemory().bundles.publishBundle(bundle, options);
    },
    async generateInternalizationSuggestions(options) {
      if (teamClient) return teamClient.bundles.generateInternalizationSuggestions(options);
      return getMemory().projections.generateInternalizationSuggestions(options);
    },
    async acceptInternalizationSuggestions(options) {
      if (teamClient) return teamClient.bundles.acceptInternalizationSuggestions(options);
      return getMemory().projections.acceptInternalizationSuggestions(options as any);
    },
    async writeObsidianProjectionFiles(options) {
      if (teamClient) return teamClient.context.writeObsidianProjectionFiles(options);
      return { files: getMemory().projections.writeObsidianProjectionFiles(options) };
    },
    async importObsidianProjectionFile(filePath) {
      if (teamClient) return teamClient.context.importObsidianProjectionFile(filePath);
      return getMemory().projections.importObsidianProjectionFile(filePath);
    },
  };
}
