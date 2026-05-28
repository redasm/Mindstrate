import type { ProjectLlmConfig } from '@mindstrate/protocol';
import type { OpenAIClient } from '../openai-client.js';
import { getOpenAIClient } from '../openai-client.js';
import { Embedder } from './embedder.js';

export interface ProjectProviders {
  embedder: Embedder;
  llmClientPromise: Promise<OpenAIClient | null>;
  llmModel: string;
  llmBaseUrl?: string;
  llmApiKey: string;
  embeddingModel: string;
  embeddingDim: number;
  hasConfig: boolean;
}

export interface LlmConfigLookup {
  getByProject(project: string): ProjectLlmConfig | null;
}

export class ProviderFactory {
  private readonly cache = new Map<string, ProjectProviders>();
  private offline?: ProjectProviders;

  constructor(private readonly repository: LlmConfigLookup) {}

  static offline(): ProviderFactory {
    return new ProviderFactory({ getByProject: () => null });
  }

  forProject(project: string): ProjectProviders {
    if (!project) return this.getOffline();
    const cached = this.cache.get(project);
    if (cached) return cached;

    const config = this.repository.getByProject(project);
    if (!config) {
      const offline = this.getOffline();
      this.cache.set(project, offline);
      return offline;
    }

    const providers = this.build(config);
    this.cache.set(project, providers);
    return providers;
  }

  invalidate(project: string): void {
    this.cache.delete(project);
  }

  invalidateAll(): void {
    this.cache.clear();
  }

  private getOffline(): ProjectProviders {
    if (this.offline) return this.offline;
    const embedder = new Embedder('');
    this.offline = {
      embedder,
      llmClientPromise: Promise.resolve(null),
      llmModel: '',
      llmApiKey: '',
      embeddingModel: 'offline-hash',
      embeddingDim: embedder.getEmbeddingDimension(),
      hasConfig: false,
    };
    return this.offline;
  }

  private build(config: ProjectLlmConfig): ProjectProviders {
    const embeddingBaseUrl = config.embeddingBaseUrl ?? config.llmBaseUrl;
    const embedder = new Embedder(config.openaiApiKey, config.embeddingModel, embeddingBaseUrl);
    const llmClientPromise = getOpenAIClient(config.openaiApiKey, config.llmBaseUrl).then((c) => c ?? null);
    return {
      embedder,
      llmClientPromise,
      llmModel: config.llmModel,
      llmBaseUrl: config.llmBaseUrl,
      llmApiKey: config.openaiApiKey,
      embeddingModel: config.embeddingModel,
      embeddingDim: config.embeddingDim,
      hasConfig: true,
    };
  }
}
