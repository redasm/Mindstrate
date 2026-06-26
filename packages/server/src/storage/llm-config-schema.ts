import type Database from 'better-sqlite3';

export const initializeLlmConfigSchema = (db: Database.Database): void => {
  db.exec(`
    CREATE TABLE IF NOT EXISTS project_llm_configs (
      id TEXT PRIMARY KEY,
      project TEXT NOT NULL UNIQUE,
      openai_api_key TEXT NOT NULL,
      embedding_api_key TEXT,
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

  // Migrate existing DBs created before embedding_api_key existed.
  const columns = db.prepare('PRAGMA table_info(project_llm_configs)').all() as Array<{ name: string }>;
  if (!columns.some((c) => c.name === 'embedding_api_key')) {
    db.exec('ALTER TABLE project_llm_configs ADD COLUMN embedding_api_key TEXT');
  }
};
