/**
 * Server-side singleton: Mindstrate instance
 */
import { Mindstrate, consoleLogger } from '@mindstrate/server';

let instance: Mindstrate | null = null;

export function getMemory(): Mindstrate {
  if (!instance) {
    instance = new Mindstrate({ logger: consoleLogger });
  }
  return instance;
}

export async function getMemoryReady(): Promise<Mindstrate> {
  const m = getMemory();
  await m.init();
  return m;
}
