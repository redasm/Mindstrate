/**
 * Mindstrate - Shared OpenAI-compatible Client Factory
 *
 * Returns an OpenAI SDK client. The default endpoint is OpenAI's official
 * API, but any provider that speaks the OpenAI HTTP protocol works by
 * passing a `baseURL`:
 *
 *   - Aliyun Tongyi Qianwen (DashScope OpenAI-compatible mode):
 *       https://dashscope.aliyuncs.com/compatible-mode/v1
 *   - DeepSeek:    https://api.deepseek.com/v1
 *   - Moonshot:    https://api.moonshot.cn/v1
 *   - Zhipu GLM:   https://open.bigmodel.cn/api/paas/v4
 *   - Together AI: https://api.together.xyz/v1
 *   - Groq:        https://api.groq.com/openai/v1
 *   - Local Ollama: http://127.0.0.1:11434/v1
 *   - Local vLLM:   http://127.0.0.1:8000/v1
 *
 * Clients are cached by (apiKey, baseURL) so that mixing providers — e.g.
 * embeddings via OpenAI but chat via DeepSeek — doesn't accidentally share
 * the wrong client instance.
 */

/** Type for OpenAI client (duck-typed to avoid ESM/CJS import issues) */
export interface OpenAIClient {
  embeddings: {
    create(params: {
      model: string;
      input: string | string[];
    }): Promise<{
      data: Array<{ embedding: number[]; index: number }>;
    }>;
  };
  chat: {
    completions: {
      create(params: {
        model: string;
        messages: Array<{ role: string; content: string }>;
        temperature?: number;
        max_tokens?: number;
        response_format?: { type: string };
      }): Promise<{
        choices: Array<{
          message?: { content?: string | null };
        }>;
      }>;
    };
  };
}

/** Cache key combining apiKey and baseURL — see file header for why. */
function cacheKey(apiKey: string, baseURL: string | undefined): string {
  return `${baseURL ?? '<default>'}::${apiKey}`;
}

/** Cached OpenAI client instances keyed by (apiKey, baseURL). */
const clientCache = new Map<string, OpenAIClient>();

/**
 * Get or create a shared OpenAI-compatible client.
 *
 * @param apiKey   The API key (or any non-empty placeholder for keyless local servers).
 * @param baseURL  Optional. Defaults to OpenAI official endpoint.
 *                 Pass e.g. "https://dashscope.aliyuncs.com/compatible-mode/v1"
 *                 to use Aliyun's OpenAI-compatible mode.
 * @returns        Client instance, or null when apiKey is empty or the
 *                 openai npm package is unavailable.
 */
export async function getOpenAIClient(
  apiKey: string,
  baseURL?: string,
): Promise<OpenAIClient | null> {
  if (!apiKey) return null;

  const key = cacheKey(apiKey, baseURL);
  const cached = clientCache.get(key);
  if (cached) return cached;

  try {
    const { default: OpenAIClass } = await import('openai');
    // OpenAI SDK ignores `baseURL: undefined` and falls back to the default,
    // so it's safe to always pass the field.
    const client = new OpenAIClass({ apiKey, baseURL }) as unknown as OpenAIClient;
    clientCache.set(key, client);
    return client;
  } catch {
    // OpenAI package unavailable
    return null;
  }
}

/**
 * Clear the client cache (useful for testing).
 */
export function clearOpenAIClientCache(): void {
  clientCache.clear();
}
