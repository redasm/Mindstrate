import type { ApiKey, CreateApiKeyInput } from '@mindstrate/protocol';
import type { MindstrateRuntime } from './mindstrate-runtime.js';

export class MindstrateApiKeysApi {
  constructor(private readonly services: MindstrateRuntime) {}

  create(input: CreateApiKeyInput): ApiKey {
    return this.services.apiKeyRepository.create(input);
  }

  findActiveByKey(key: string): ApiKey | null {
    return this.services.apiKeyRepository.findActiveByKey(key);
  }

  listActive(): ApiKey[] {
    return this.services.apiKeyRepository.listActive();
  }

  getById(id: string): ApiKey | null {
    return this.services.apiKeyRepository.getById(id);
  }

  revoke(id: string): boolean {
    return this.services.apiKeyRepository.revoke(id);
  }
}
