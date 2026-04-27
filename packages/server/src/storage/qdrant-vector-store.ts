import { StorageError } from '@mindstrate/protocol';
import type { IVectorStore, VectorDocument, VectorSearchResult } from './vector-store-interface.js';

interface QdrantPoint {
  id: string;
  score?: number;
  payload?: {
    text?: string;
    metadata?: Record<string, string | number | boolean>;
  };
}

export interface QdrantVectorStoreOptions {
  url: string;
  apiKey?: string;
  collectionName: string;
  dimension: number;
}

export class QdrantVectorStore implements IVectorStore {
  private readonly baseUrl: string;
  private readonly apiKey?: string;
  private readonly collectionName: string;
  private readonly dimension: number;

  constructor(options: QdrantVectorStoreOptions) {
    if (!options.url) {
      throw new StorageError('Qdrant vector backend requires MINDSTRATE_QDRANT_URL.', {});
    }

    this.baseUrl = options.url.replace(/\/+$/, '');
    this.apiKey = options.apiKey;
    this.collectionName = options.collectionName;
    this.dimension = options.dimension;
  }

  async initialize(): Promise<void> {
    await this.request(`/collections/${encodeURIComponent(this.collectionName)}`, {
      method: 'PUT',
      body: JSON.stringify({
        vectors: {
          size: this.dimension,
          distance: 'Cosine',
        },
      }),
    });
  }

  async add(doc: VectorDocument): Promise<void> {
    await this.addBatch([doc]);
  }

  async addBatch(docs: VectorDocument[]): Promise<void> {
    if (docs.length === 0) return;

    await this.request(`/collections/${encodeURIComponent(this.collectionName)}/points?wait=true`, {
      method: 'PUT',
      body: JSON.stringify({
        points: docs.map((doc) => ({
          id: doc.id,
          vector: doc.embedding,
          payload: {
            text: doc.text,
            metadata: doc.metadata ?? {},
          },
        })),
      }),
    });
  }

  async update(doc: VectorDocument): Promise<void> {
    await this.add(doc);
  }

  async delete(id: string): Promise<void> {
    await this.request(`/collections/${encodeURIComponent(this.collectionName)}/points/delete?wait=true`, {
      method: 'POST',
      body: JSON.stringify({
        points: [id],
      }),
    });
  }

  async search(
    embedding: number[],
    topK: number = 5,
    filter?: Record<string, string | number | boolean>,
  ): Promise<VectorSearchResult[]> {
    const response = await this.request<{ result?: QdrantPoint[] }>(
      `/collections/${encodeURIComponent(this.collectionName)}/points/search`,
      {
        method: 'POST',
        body: JSON.stringify({
          vector: embedding,
          limit: topK,
          with_payload: true,
          filter: filter ? toQdrantFilter(filter) : undefined,
        }),
      },
    );

    return (response.result ?? []).map((point) => ({
      id: point.id,
      score: point.score ?? 0,
      distance: 1 - (point.score ?? 0),
      text: point.payload?.text,
      metadata: point.payload?.metadata,
    }));
  }

  async findDuplicates(
    embedding: number[],
    threshold: number = 0.92,
    topK: number = 3,
  ): Promise<VectorSearchResult[]> {
    const results = await this.search(embedding, topK);
    return results.filter((result) => result.score >= threshold);
  }

  async count(): Promise<number> {
    const response = await this.request<{ result?: { count?: number } }>(
      `/collections/${encodeURIComponent(this.collectionName)}/points/count`,
      {
        method: 'POST',
        body: JSON.stringify({ exact: true }),
      },
    );
    return response.result?.count ?? 0;
  }

  flush(): void {
    // Qdrant writes are sent immediately.
  }

  private async request<T = unknown>(pathname: string, init: RequestInit): Promise<T> {
    const headers: Record<string, string> = {
      'content-type': 'application/json',
    };
    if (this.apiKey) {
      headers['api-key'] = this.apiKey;
    }

    const response = await fetch(`${this.baseUrl}${pathname}`, {
      ...init,
      headers,
    });

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new StorageError(`Qdrant request failed: ${response.status} ${body}`.trim(), {
        status: response.status,
        path: pathname,
      });
    }

    if (response.status === 204) {
      return {} as T;
    }

    return await response.json() as T;
  }
}

function toQdrantFilter(filter: Record<string, string | number | boolean>): object {
  return {
    must: Object.entries(filter)
      .filter(([, value]) => value !== undefined && value !== '')
      .map(([key, value]) => ({
        key: `metadata.${key}`,
        match: { value },
      })),
  };
}
