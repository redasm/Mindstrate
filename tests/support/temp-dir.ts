import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

export function createTempDir(prefix = 'mindstrate-test-'): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

export function removeTempDir(dir: string): void {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    // Best-effort cleanup after tests.
  }
}
