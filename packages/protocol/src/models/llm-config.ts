export interface ProjectLlmConfig {
  id: string;
  project: string;
  openaiApiKey: string;
  llmBaseUrl?: string;
  embeddingBaseUrl?: string;
  llmModel: string;
  embeddingModel: string;
  embeddingDim: number;
  createdAt: string;
  updatedAt: string;
}

export interface CreateLlmConfigInput {
  project: string;
  openaiApiKey: string;
  llmBaseUrl?: string;
  embeddingBaseUrl?: string;
  llmModel: string;
  embeddingModel: string;
  embeddingDim: number;
}

export interface UpdateLlmConfigInput {
  openaiApiKey?: string;
  llmBaseUrl?: string | null;
  embeddingBaseUrl?: string | null;
  llmModel?: string;
  embeddingModel?: string;
  embeddingDim?: number;
}
