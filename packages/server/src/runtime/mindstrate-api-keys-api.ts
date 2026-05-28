import type { ApiKey, ApiKeyRole, CreateApiKeyInput } from '@mindstrate/protocol';
import type { MindstrateRuntime } from './mindstrate-runtime.js';

export class MindstrateApiKeysApi {
  constructor(private readonly services: MindstrateRuntime) {}

  create(input: CreateApiKeyInput): ApiKey {
    return this.services.apiKeyRepository.create(input);
  }

  findActiveByKey(key: string): ApiKey | null {
    return this.services.apiKeyRepository.findActiveByKey(key);
  }

  findByNameAndKey(name: string, key: string): ApiKey | null {
    return this.services.apiKeyRepository.findByNameAndKey(name, key);
  }

  findActiveByName(name: string): ApiKey | null {
    return this.services.apiKeyRepository.findActiveByName(name);
  }

  listActive(): ApiKey[] {
    return this.services.apiKeyRepository.listActive();
  }

  listAll(): ApiKey[] {
    return this.services.apiKeyRepository.listAll();
  }

  getById(id: string): ApiKey | null {
    return this.services.apiKeyRepository.getById(id);
  }

  revoke(id: string): boolean {
    return this.services.apiKeyRepository.revoke(id);
  }

  setEnabled(id: string, enabled: boolean): boolean {
    return this.services.apiKeyRepository.setEnabled(id, enabled);
  }

  setRole(id: string, role: ApiKeyRole): boolean {
    return this.services.apiKeyRepository.setRole(id, role);
  }

  setProjects(id: string, projects: string[]): boolean {
    return this.services.apiKeyRepository.setProjects(id, projects);
  }

  regenerateKey(id: string): { newKey: string } | null {
    return this.services.apiKeyRepository.regenerateKey(id);
  }

  deleteHard(id: string): boolean {
    return this.services.apiKeyRepository.deleteHard(id);
  }

  countAdmins(): number {
    return this.services.apiKeyRepository.countAdmins();
  }
}
