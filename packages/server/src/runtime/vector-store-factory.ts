import type { MindstrateConfig } from '../config.js';
import type { IVectorStore } from '../storage/vector-store-interface.js';
import { VectorStore } from '../storage/vector-store.js';
import { QdrantVectorStore } from '../storage/qdrant-vector-store.js';
import type { ProviderFactory } from '../processing/provider-factory.js';

const slugify = (project: string): string =>
  project
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64) || 'default';

export class VectorStoreFactory {
  private readonly cache = new Map<string, IVectorStore>();
  private readonly initialized = new Set<string>();

  constructor(
    private readonly config: MindstrateConfig,
    private readonly providerFactory: ProviderFactory,
  ) {}

  async forProject(project: string): Promise<IVectorStore> {
    const key = project || '__default__';
    let store = this.cache.get(key);
    if (!store) {
      store = this.create(key);
      this.cache.set(key, store);
    }
    if (!this.initialized.has(key)) {
      await store.initialize();
      this.initialized.add(key);
    }
    return store;
  }

  flushAll(): void {
    for (const store of this.cache.values()) {
      store.flush();
    }
  }

  async initializeAll(): Promise<void> {
    // Lazy init per-project; nothing to do up front.
  }

  private create(project: string): IVectorStore {
    const slug = slugify(project);
    if (this.config.vectorBackend === 'qdrant') {
      const providers = this.providerFactory.forProject(project);
      return new QdrantVectorStore({
        url: this.config.qdrantUrl ?? '',
        apiKey: this.config.qdrantApiKey,
        collectionName: `${this.config.collectionName}-${slug}`,
        dimension: providers.embeddingDim,
      });
    }
    return new VectorStore(this.config.vectorStorePath, slug);
  }
}
