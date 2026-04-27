import { describe, it, expect } from 'vitest';
import {
  MindstrateError,
  ValidationError,
  StorageError,
  EmbeddingError,
  LLMError,
  DuplicateError,
  NotFoundError,
  TeamServerError,
  ConfigError,
} from '../src/errors.js';

/**
 * Errors are part of the public protocol — consumers (mcp-server, cli,
 * web-ui) often `catch` and `instanceof` them. We pin the class hierarchy
 * and key behaviour to make accidental refactoring loud.
 */
describe('protocol errors', () => {
  it('every error class extends MindstrateError -> Error', () => {
    const cases = [
      new ValidationError('boom'),
      new StorageError('boom'),
      new EmbeddingError('boom'),
      new LLMError('boom'),
      new ConfigError('boom'),
      new DuplicateError('dup', 'k-id'),
      new TeamServerError('http boom', 500),
      new NotFoundError('Knowledge', 'k-id'),
    ];
    for (const err of cases) {
      expect(err).toBeInstanceOf(Error);
      expect(err).toBeInstanceOf(MindstrateError);
      expect(err.code).toBeTruthy();
      expect(err.name).toBe(err.constructor.name);
    }
  });

  it('simple errors carry only message + code', () => {
    const e = new ValidationError('field x is required');
    expect(e.message).toBe('field x is required');
    expect(e.code).toBe('VALIDATION_ERROR');
    expect(e.context).toBeUndefined();
  });

  it('errors accept optional structured context', () => {
    const e = new StorageError('write failed', { table: 'context_nodes', id: 'n-1' });
    expect(e.context).toEqual({ table: 'context_nodes', id: 'n-1' });
  });

  it('DuplicateError carries duplicateOf', () => {
    const e = new DuplicateError('dup found', 'k-123');
    expect(e.duplicateOf).toBe('k-123');
    expect(e.code).toBe('DUPLICATE_ERROR');
  });

  it('NotFoundError formats its own message', () => {
    const e = new NotFoundError('Session', 's-42');
    expect(e.message).toBe('Session not found: s-42');
    expect(e.code).toBe('NOT_FOUND');
    expect(e.context).toEqual({ entityType: 'Session', id: 's-42' });
  });

  it('TeamServerError carries optional statusCode', () => {
    const e = new TeamServerError('rate limited', 429);
    expect(e.statusCode).toBe(429);
    const e2 = new TeamServerError('connection refused');
    expect(e2.statusCode).toBeUndefined();
  });

  it('errors round-trip through JSON via name+message+code (wire format)', () => {
    const original = new TeamServerError('502 upstream', 502);
    const onWire = JSON.stringify({
      name: original.name,
      code: original.code,
      message: original.message,
      statusCode: original.statusCode,
    });
    const parsed = JSON.parse(onWire);
    expect(parsed.name).toBe('TeamServerError');
    expect(parsed.code).toBe('TEAM_SERVER_ERROR');
    expect(parsed.message).toBe('502 upstream');
    expect(parsed.statusCode).toBe(502);
  });
});
