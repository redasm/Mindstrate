export interface ProjectLlmConfig {
  id: string;
  project: string;
  openaiApiKey: string;
  /** Separate key for the embedding endpoint; falls back to openaiApiKey when unset. */
  embeddingApiKey?: string;
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
  embeddingApiKey?: string;
  llmBaseUrl?: string;
  embeddingBaseUrl?: string;
  llmModel: string;
  embeddingModel: string;
  embeddingDim: number;
}

export interface UpdateLlmConfigInput {
  openaiApiKey?: string;
  embeddingApiKey?: string | null;
  llmBaseUrl?: string | null;
  embeddingBaseUrl?: string | null;
  llmModel?: string;
  embeddingModel?: string;
  embeddingDim?: number;
}
