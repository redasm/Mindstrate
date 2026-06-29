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

/**
 * Whether an embedding model accepts a custom `dimensions` request parameter.
 * Aliyun text-embedding-v3/v4 and OpenAI text-embedding-3-* support it;
 * fixed-dimension models (Aliyun v2/v1 at 1536, OpenAI ada-002) reject it, so
 * the param must be omitted for them. Defaults to false for unknown models —
 * safer to omit than to send a param a provider might 400 on.
 */
export const supportsCustomDimensions = (model: string): boolean => {
  const m = model.toLowerCase();
  if (m.includes('text-embedding-v4') || m.includes('text-embedding-v3')) return true;
  if (m.includes('text-embedding-3-small') || m.includes('text-embedding-3-large')) return true;
  return false;
};

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
    // Embedding may use a different provider than the chat LLM (e.g. chat on
    // DeepSeek, embeddings on Aliyun), which means a different API key. Fall
    // back to the main key when no separate embedding key is set.
    const embeddingApiKey = config.embeddingApiKey ?? config.openaiApiKey;
    const embedder = new Embedder(embeddingApiKey, config.embeddingModel, embeddingBaseUrl, {
      // Only send the `dimensions` param to models that support custom output
      // dims; fixed-dimension models (Aliyun v2/v1, OpenAI ada-002) reject it.
      // Without this the configured embeddingDim was silently ignored and the
      // model returned its default size.
      dimensions: supportsCustomDimensions(config.embeddingModel) ? config.embeddingDim : undefined,
    });
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
