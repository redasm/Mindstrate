import type Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import type {
  ProjectLlmConfig,
  CreateLlmConfigInput,
  UpdateLlmConfigInput,
} from '@mindstrate/protocol';
import { initializeLlmConfigSchema } from './llm-config-schema.js';

interface LlmConfigRow {
  id: string;
  project: string;
  openai_api_key: string;
  llm_base_url: string | null;
  embedding_base_url: string | null;
  llm_model: string;
  embedding_model: string;
  embedding_dim: number;
  created_at: string;
  updated_at: string;
}

const rowToConfig = (row: LlmConfigRow): ProjectLlmConfig => ({
  id: row.id,
  project: row.project,
  openaiApiKey: row.openai_api_key,
  llmBaseUrl: row.llm_base_url ?? undefined,
  embeddingBaseUrl: row.embedding_base_url ?? undefined,
  llmModel: row.llm_model,
  embeddingModel: row.embedding_model,
  embeddingDim: row.embedding_dim,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

export class LlmConfigRepository {
  private readonly db: Database.Database;

  constructor(db: Database.Database) {
    this.db = db;
    initializeLlmConfigSchema(this.db);
  }

  list(): ProjectLlmConfig[] {
    const rows = this.db
      .prepare('SELECT * FROM project_llm_configs ORDER BY project ASC')
      .all() as LlmConfigRow[];
    return rows.map(rowToConfig);
  }

  getById(id: string): ProjectLlmConfig | null {
    const row = this.db
      .prepare('SELECT * FROM project_llm_configs WHERE id = ?')
      .get(id) as LlmConfigRow | undefined;
    return row ? rowToConfig(row) : null;
  }

  getByProject(project: string): ProjectLlmConfig | null {
    const row = this.db
      .prepare('SELECT * FROM project_llm_configs WHERE project = ?')
      .get(project) as LlmConfigRow | undefined;
    return row ? rowToConfig(row) : null;
  }

  create(input: CreateLlmConfigInput): ProjectLlmConfig {
    const now = new Date().toISOString();
    const id = randomUUID();
    this.db
      .prepare(
        `INSERT INTO project_llm_configs (
          id, project, openai_api_key, llm_base_url, embedding_base_url,
          llm_model, embedding_model, embedding_dim, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        input.project,
        input.openaiApiKey,
        input.llmBaseUrl ?? null,
        input.embeddingBaseUrl ?? null,
        input.llmModel,
        input.embeddingModel,
        input.embeddingDim,
        now,
        now,
      );
    return this.getById(id)!;
  }

  update(id: string, patch: UpdateLlmConfigInput): ProjectLlmConfig | null {
    const current = this.getById(id);
    if (!current) return null;

    const fields: string[] = [];
    const values: (string | number | null)[] = [];
    const setField = (column: string, value: string | number | null | undefined) => {
      if (value === undefined) return;
      fields.push(`${column} = ?`);
      values.push(value);
    };

    setField('openai_api_key', patch.openaiApiKey);
    setField('llm_base_url', patch.llmBaseUrl);
    setField('embedding_base_url', patch.embeddingBaseUrl);
    setField('llm_model', patch.llmModel);
    setField('embedding_model', patch.embeddingModel);
    setField('embedding_dim', patch.embeddingDim);

    if (fields.length === 0) return current;

    fields.push('updated_at = ?');
    values.push(new Date().toISOString());
    values.push(id);

    this.db
      .prepare(`UPDATE project_llm_configs SET ${fields.join(', ')} WHERE id = ?`)
      .run(...values);
    return this.getById(id);
  }

  delete(id: string): boolean {
    const result = this.db
      .prepare('DELETE FROM project_llm_configs WHERE id = ?')
      .run(id);
    return result.changes > 0;
  }
}
