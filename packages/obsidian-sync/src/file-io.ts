import * as fs from 'node:fs';
import { errorMessage } from '@mindstrate/server';

export function readTextIfExists(filePath: string): string | null {
  try {
    return fs.readFileSync(filePath, 'utf8');
  } catch {
    return null;
  }
}

export { errorMessage };
