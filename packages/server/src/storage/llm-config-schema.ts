import type Database from 'better-sqlite3';

export const initializeLlmConfigSchema = (db: Database.Database): void => {
  db.exec(`
    CREATE TABLE IF NOT EXISTS project_llm_configs (
      id TEXT PRIMARY KEY,
      project TEXT NOT NULL UNIQUE,
      openai_api_key TEXT NOT NULL,
      llm_base_url TEXT,
      embedding_base_url TEXT,
      llm_model TEXT NOT NULL,
      embedding_model TEXT NOT NULL,
      embedding_dim INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_project_llm_configs_project ON project_llm_configs(project);
  `);
};
