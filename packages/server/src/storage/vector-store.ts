/**
 * Mindstrate - Local Vector Store
 *
 * 基于本地 JSON 文件的向量存储，零外部依赖。
 * 使用余弦相似度进行语义搜索。
 * 实现 IVectorStore 接口，可替换为 ChromaDB / Qdrant。
 *
 * 适用于 MVP / 小团队场景（< 10000 条知识）。
 */

import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import * as path from 'node:path';
import type { IVectorStore, VectorDocument, VectorSearchResult } from './vector-store-interface.js';
import { cosineSimilarity } from '../math.js';
import { StorageError } from '@mindstrate/protocol';

interface StoredDocument {
  id: string;
  embedding: number[];
  text: string;
  metadata?: Record<string, string | number | boolean>;
}

interface VectorIndex {
  version: number;
  documents: StoredDocument[];
}

export class VectorStore implements IVectorStore {
  private indexPath: string;
  private lockPath: string;
  private index: VectorIndex;
  private dirty = false;
  /** Cached embedding dimension from the first document added (for consistency checks) */
  private expectedDimension: number | null = null;

  constructor(storagePath: string, collectionName: string = 'mindstrate') {
    // 确保目录存在
    if (!fs.existsSync(storagePath)) {
      fs.mkdirSync(storagePath, { recursive: true });
    }

    this.indexPath = path.join(storagePath, `${collectionName}.vectors.json`);
    this.lockPath = this.indexPath + '.lock';
    this.index = this.loadIndex();

    // Infer expected dimension from existing documents
    if (this.index.documents.length > 0) {
      this.expectedDimension = this.index.documents[0].embedding.length;
    }
  }

  /** 初始化（本地模式无需异步初始化，保持接口兼容） */
  async initialize(): Promise<void> {
    // 已在构造函数中完成
  }

  /** 添加文档 */
  async add(doc: VectorDocument): Promise<void> {
    this.validateDimension(doc.embedding);

    // 如果已存在则更新
    const existingIdx = this.index.documents.findIndex(d => d.id === doc.id);
    if (existingIdx >= 0) {
      this.index.documents[existingIdx] = doc;
    } else {
      this.index.documents.push(doc);
    }
    this.dirty = true;
    await this.saveAsync();
  }

  /** 批量添加文档 */
  async addBatch(docs: VectorDocument[]): Promise<void> {
    for (const doc of docs) {
      this.validateDimension(doc.embedding);

      const existingIdx = this.index.documents.findIndex(d => d.id === doc.id);
      if (existingIdx >= 0) {
        this.index.documents[existingIdx] = doc;
      } else {
        this.index.documents.push(doc);
      }
    }
    this.dirty = true;
    await this.saveAsync();
  }

  /** 更新文档 */
  async update(doc: VectorDocument): Promise<void> {
    await this.add(doc); // add 已处理 upsert
  }

  /** 删除文档 */
  async delete(id: string): Promise<void> {
    this.index.documents = this.index.documents.filter(d => d.id !== id);
    this.dirty = true;
    await this.saveAsync();
  }

  /** 语义搜索：根据 embedding 向量查找相似文档 */
  async search(
    embedding: number[],
    topK: number = 5,
    filter?: Record<string, string | number | boolean>,
  ): Promise<VectorSearchResult[]> {
    let candidates = this.index.documents;

    // 应用元数据过滤
    if (filter) {
      candidates = candidates.filter(doc => {
        if (!doc.metadata) return false;
        for (const [key, value] of Object.entries(filter)) {
          if (value !== undefined && value !== '' && doc.metadata[key] !== value) {
            return false;
          }
        }
        return true;
      });
    }

    // 计算余弦相似度
    const scored: VectorSearchResult[] = candidates.map(doc => {
      const similarity = cosineSimilarity(embedding, doc.embedding);
      return {
        id: doc.id,
        distance: 1 - similarity,
        score: similarity,
        text: doc.text,
        metadata: doc.metadata,
      };
    });

    // 按相似度降序排序，取 Top-K
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, topK);
  }

  /** 查找与给定 embedding 相似度超过阈值的文档（用于去重） */
  async findDuplicates(
    embedding: number[],
    threshold: number = 0.92,
    topK: number = 3,
  ): Promise<VectorSearchResult[]> {
    const results = await this.search(embedding, topK);
    return results.filter(r => r.score >= threshold);
  }

  /** 获取文档数量 */
  async count(): Promise<number> {
    return this.index.documents.length;
  }

  // ========================================
  // Private
  // ========================================

  /**
   * Validate that embedding dimensions are consistent across the store.
   * Prevents silent data corruption when switching between local/OpenAI modes.
   */
  private validateDimension(embedding: number[]): void {
    if (this.expectedDimension === null) {
      this.expectedDimension = embedding.length;
      return;
    }
    if (embedding.length !== this.expectedDimension) {
      throw new StorageError(
        `Embedding dimension mismatch: expected ${this.expectedDimension} but got ${embedding.length}. ` +
        `This usually happens when switching between local (256d) and OpenAI (1536d) embedding modes. ` +
        `To fix, either set OPENAI_API_KEY consistently or clear the vector store.`,
        { expected: this.expectedDimension, actual: embedding.length },
      );
    }
  }

  private loadIndex(): VectorIndex {
    if (fs.existsSync(this.indexPath)) {
      try {
        const data = fs.readFileSync(this.indexPath, 'utf-8');
        return JSON.parse(data);
      } catch {
        // 文件损坏，重新创建
        return { version: 1, documents: [] };
      }
    }
    return { version: 1, documents: [] };
  }

  private async saveAsync(): Promise<void> {
    if (!this.dirty) return;
    await this.flushToDiskAsync();
  }

  /** 立即写入磁盘（用于确保数据持久化） */
  flush(): void {
    this.flushToDiskSync();
  }

  /** Async flush - used during normal operations to avoid blocking the event loop */
  private async flushToDiskAsync(): Promise<void> {
    if (!this.dirty) return;

    try {
      this.acquireLock();
      const data = JSON.stringify(this.index);
      await fsp.writeFile(this.indexPath, data, 'utf-8');
      this.dirty = false;
    } catch (err) {
      throw new StorageError(
        `Failed to write vector index to ${this.indexPath}: ${err instanceof Error ? err.message : String(err)}`,
        { path: this.indexPath },
      );
    } finally {
      this.releaseLock();
    }
  }

  /** Sync flush - only used during shutdown (close/flush) where we can't await */
  private flushToDiskSync(): void {
    if (!this.dirty) return;

    try {
      this.acquireLock();
      fs.writeFileSync(this.indexPath, JSON.stringify(this.index), 'utf-8');
      this.dirty = false;
    } catch (err) {
      throw new StorageError(
        `Failed to write vector index to ${this.indexPath}: ${err instanceof Error ? err.message : String(err)}`,
        { path: this.indexPath },
      );
    } finally {
      this.releaseLock();
    }
  }

  /**
   * Simple file-based lock using exclusive file creation.
   * Retries a few times with backoff for concurrent access scenarios.
   */
  private acquireLock(maxRetries = 5): void {
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        // O_CREAT | O_EXCL: create only if it doesn't exist (atomic)
        const fd = fs.openSync(this.lockPath, 'wx');
        fs.writeFileSync(fd, String(process.pid));
        fs.closeSync(fd);
        return; // lock acquired
      } catch (err: any) {
        if (err.code === 'EEXIST') {
          // Check for stale lock (process may have crashed)
          try {
            const lockStat = fs.statSync(this.lockPath);
            const ageMs = Date.now() - lockStat.mtimeMs;
            if (ageMs > 30_000) {
              // Stale lock (> 30 seconds), force remove
              fs.unlinkSync(this.lockPath);
              continue;
            }
          } catch {
            // Lock file was removed between check and stat
            continue;
          }

          // Wait and retry with exponential backoff
          if (attempt < maxRetries - 1) {
            const waitMs = Math.min(10 * Math.pow(2, attempt), 500);
            // Use Atomics.wait for non-CPU-spinning synchronous sleep
            Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, waitMs);
          }
        } else {
          // Non-lock-contention error, proceed without lock
          return;
        }
      }
    }
    // If we couldn't acquire the lock after retries, proceed anyway
    // (better to risk a rare corruption than to block indefinitely)
  }

  private releaseLock(): void {
    try {
      fs.unlinkSync(this.lockPath);
    } catch {
      // Lock file already removed
    }
  }
}
