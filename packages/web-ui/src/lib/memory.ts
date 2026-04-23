/**
 * Server-side singleton: Mindstrate instance
 */
import { Mindstrate } from '@mindstrate/server';

let instance: Mindstrate | null = null;

export function getMemory(): Mindstrate {
  if (!instance) {
    instance = new Mindstrate();
  }
  return instance;
}

export async function getMemoryReady(): Promise<Mindstrate> {
  const m = getMemory();
  await m.init();
  return m;
}
