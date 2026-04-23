/**
 * Mindstrate - Vector Store Interface
 *
 * Pluggable vector store abstraction. Implementations:
 * - LocalVectorStore: JSON file-based (default, for <10k entries)
 * - Future: ChromaDB, Qdrant, Milvus adapters
 */

export interface VectorDocument {
  id: string;
  embedding: number[];
  text: string;
  metadata?: Record<string, string | number | boolean>;
}

export interface VectorSearchResult {
  id: string;
  distance: number;
  score: number;       // cosine similarity 0-1
  text?: string;
  metadata?: Record<string, string | number | boolean>;
}

/**
 * Abstract interface for vector storage backends.
 *
 * All methods are async to support both local and remote backends.
 */
export interface IVectorStore {
  /** Initialize the store (create collections, connect, etc.) */
  initialize(): Promise<void>;

  /** Add or upsert a single document */
  add(doc: VectorDocument): Promise<void>;

  /** Add or upsert multiple documents */
  addBatch(docs: VectorDocument[]): Promise<void>;

  /** Update an existing document */
  update(doc: VectorDocument): Promise<void>;

  /** Delete a document by ID */
  delete(id: string): Promise<void>;

  /** Semantic search by embedding vector */
  search(
    embedding: number[],
    topK?: number,
    filter?: Record<string, string | number | boolean>,
  ): Promise<VectorSearchResult[]>;

  /** Find duplicates above a similarity threshold */
  findDuplicates(
    embedding: number[],
    threshold?: number,
    topK?: number,
  ): Promise<VectorSearchResult[]>;

  /** Get total document count */
  count(): Promise<number>;

  /** Flush pending writes to persistent storage */
  flush(): void;
}
