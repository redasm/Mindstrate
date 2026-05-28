import type {
  CreateLlmConfigInput,
  ProjectLlmConfig,
  UpdateLlmConfigInput,
} from '@mindstrate/protocol';
import type { MindstrateRuntime } from './mindstrate-runtime.js';

export class MindstrateLlmConfigsApi {
  constructor(private readonly services: MindstrateRuntime) {}

  list(): ProjectLlmConfig[] {
    return this.services.llmConfigRepository.list();
  }

  getById(id: string): ProjectLlmConfig | null {
    return this.services.llmConfigRepository.getById(id);
  }

  getByProject(project: string): ProjectLlmConfig | null {
    return this.services.llmConfigRepository.getByProject(project);
  }

  create(input: CreateLlmConfigInput): ProjectLlmConfig {
    const config = this.services.llmConfigRepository.create(input);
    this.services.providerFactory.invalidate(input.project);
    return config;
  }

  update(id: string, patch: UpdateLlmConfigInput): ProjectLlmConfig | null {
    const updated = this.services.llmConfigRepository.update(id, patch);
    if (updated) {
      this.services.providerFactory.invalidate(updated.project);
    }
    return updated;
  }

  delete(id: string): boolean {
    const existing = this.services.llmConfigRepository.getById(id);
    const result = this.services.llmConfigRepository.delete(id);
    if (existing) {
      this.services.providerFactory.invalidate(existing.project);
    }
    return result;
  }
}
