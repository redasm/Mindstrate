import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { readJsonFile, readJsonFileOrThrow } from '../src/storage/json-file.js';

const withTempFile = (
  contents: string | null,
  body: (filePath: string) => void,
): void => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mindstrate-json-file-'));
  const filePath = path.join(dir, 'sample.json');
  if (contents !== null) fs.writeFileSync(filePath, contents, 'utf8');
  try {
    body(filePath);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
};

describe('readJsonFile', () => {
  it('returns null when the file does not exist', () => {
    withTempFile(null, (filePath) => {
      expect(readJsonFile<{ foo: string }>(filePath)).toBeNull();
    });
  });

  it('returns null when the file is unreadable JSON', () => {
    withTempFile('not really json {', (filePath) => {
      expect(readJsonFile<{ foo: string }>(filePath)).toBeNull();
    });
  });

  it('returns the parsed payload for valid JSON', () => {
    withTempFile(JSON.stringify({ foo: 'bar', count: 3 }), (filePath) => {
      expect(readJsonFile<{ foo: string; count: number }>(filePath))
        .toEqual({ foo: 'bar', count: 3 });
    });
  });

  it('returns null for empty files', () => {
    withTempFile('', (filePath) => {
      expect(readJsonFile<unknown>(filePath)).toBeNull();
    });
  });
});

describe('readJsonFileOrThrow', () => {
  it('returns the parsed payload for valid JSON', () => {
    withTempFile(JSON.stringify({ ok: true }), (filePath) => {
      expect(readJsonFileOrThrow<{ ok: boolean }>(filePath)).toEqual({ ok: true });
    });
  });

  it('throws with a path-bearing error when the file is missing', () => {
    withTempFile(null, (filePath) => {
      expect(() => readJsonFileOrThrow(filePath)).toThrow(/Failed to read JSON file/);
      expect(() => readJsonFileOrThrow(filePath)).toThrow(filePath);
    });
  });

  it('throws with a path-bearing error when the JSON is invalid', () => {
    withTempFile('{invalid', (filePath) => {
      expect(() => readJsonFileOrThrow(filePath)).toThrow(/Failed to parse JSON file/);
      expect(() => readJsonFileOrThrow(filePath)).toThrow(filePath);
    });
  });
});
