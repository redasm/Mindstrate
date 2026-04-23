/**
 * Mindstrate - Custom Error Hierarchy
 *
 * Structured error types for better error handling and debugging.
 */

/** Base error for all Mindstrate errors */
export class MindstrateError extends Error {
  public readonly code: string;
  public readonly context?: Record<string, unknown>;

  constructor(message: string, code: string, context?: Record<string, unknown>) {
    super(message);
    this.name = 'MindstrateError';
    this.code = code;
    this.context = context;
  }
}

/** Errors related to data validation */
export class ValidationError extends MindstrateError {
  constructor(message: string, context?: Record<string, unknown>) {
    super(message, 'VALIDATION_ERROR', context);
    this.name = 'ValidationError';
  }
}

/** Errors related to storage operations (SQLite, vector store) */
export class StorageError extends MindstrateError {
  constructor(message: string, context?: Record<string, unknown>) {
    super(message, 'STORAGE_ERROR', context);
    this.name = 'StorageError';
  }
}

/** Errors related to embedding generation */
export class EmbeddingError extends MindstrateError {
  constructor(message: string, context?: Record<string, unknown>) {
    super(message, 'EMBEDDING_ERROR', context);
    this.name = 'EmbeddingError';
  }
}

/** Errors related to LLM API calls */
export class LLMError extends MindstrateError {
  constructor(message: string, context?: Record<string, unknown>) {
    super(message, 'LLM_ERROR', context);
    this.name = 'LLMError';
  }
}

/** Errors for duplicate knowledge detection */
export class DuplicateError extends MindstrateError {
  public readonly duplicateOf: string;

  constructor(message: string, duplicateOf: string, context?: Record<string, unknown>) {
    super(message, 'DUPLICATE_ERROR', context);
    this.name = 'DuplicateError';
    this.duplicateOf = duplicateOf;
  }
}

/** Errors for knowledge not found */
export class NotFoundError extends MindstrateError {
  constructor(entityType: string, id: string) {
    super(`${entityType} not found: ${id}`, 'NOT_FOUND', { entityType, id });
    this.name = 'NotFoundError';
  }
}

/** Errors for team server communication */
export class TeamServerError extends MindstrateError {
  public readonly statusCode?: number;

  constructor(message: string, statusCode?: number, context?: Record<string, unknown>) {
    super(message, 'TEAM_SERVER_ERROR', context);
    this.name = 'TeamServerError';
    this.statusCode = statusCode;
  }
}

/** Errors for configuration issues */
export class ConfigError extends MindstrateError {
  constructor(message: string, context?: Record<string, unknown>) {
    super(message, 'CONFIG_ERROR', context);
    this.name = 'ConfigError';
  }
}
