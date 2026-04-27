import type {
  AcceptInternalizationSuggestionsResult,
  InstallBundleResult,
  InternalizationSuggestions,
  PortableContextBundle,
  PublishBundleOptions,
  PublishBundleResult,
} from '@mindstrate/protocol';
import type { InternalizationTarget } from './context-client.js';
import { TeamDomainClient } from './team-domain-client.js';

export class BundleClient extends TeamDomainClient {
  async create(options: {
    name: string;
    version?: string;
    description?: string;
    project?: string;
    nodeIds?: string[];
    includeRelatedEdges?: boolean;
  }): Promise<PortableContextBundle> {
    return this.post('/api/bundles/create', options);
  }

  async validate(bundle: PortableContextBundle): Promise<{ valid: boolean; errors: string[] }> {
    return this.post('/api/bundles/validate', { bundle });
  }

  async install(bundle: PortableContextBundle): Promise<InstallBundleResult> {
    return this.post('/api/bundles/install', { bundle });
  }

  async installFromRegistry(options: {
    registry: string;
    reference: string;
  }): Promise<InstallBundleResult> {
    return this.post('/api/bundles/install-ref', options);
  }

  async publish(
    bundle: PortableContextBundle,
    options: PublishBundleOptions = {},
  ): Promise<PublishBundleResult> {
    return this.post('/api/bundles/publish', {
      bundle,
      registry: options.registry,
      visibility: options.visibility,
    });
  }

  async generateInternalizationSuggestions(options?: {
    project?: string;
    limit?: number;
  }): Promise<InternalizationSuggestions> {
    return this.post('/api/context/internalize', options ?? {});
  }

  async acceptInternalizationSuggestions(options?: {
    project?: string;
    limit?: number;
    targets?: InternalizationTarget[];
  }): Promise<AcceptInternalizationSuggestionsResult> {
    return this.post('/api/context/internalize/accept', options ?? {});
  }
}
