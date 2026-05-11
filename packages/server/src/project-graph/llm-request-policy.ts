/**
 * Project graph LLM request throttling.
 *
 * 状态是 process-global 的：`requestQueue` 把所有调用串成一条链，`lastRequestAt`
 * 强制相邻请求之间的最小间隔。这样设计是因为 LLM provider 的速率限制是 API key
 * 维度（不是 project 维度），同一 process 内多个 project 共享一个 key 时必须共
 * 享节流通道。
 *
 * 配置经 `MindstrateConfig.projectGraphLlm` 注入，env 解析在 `loadConfig` 完成；
 * 这里不再读 env，避免双重 fallback 路径。
 */

export interface ProjectGraphLlmRequestPolicy {
  factBatchSize?: number;
  requestDelayMs?: number;
  requestTimeoutMs?: number;
}

const DEFAULT_FACT_BATCH_SIZE = 20;
const DEFAULT_REQUEST_DELAY_MS = 1500;

let requestQueue: Promise<void> = Promise.resolve();
let lastRequestAt = 0;

export const projectGraphLlmFactBatchSize = (policy?: ProjectGraphLlmRequestPolicy): number =>
  positiveInteger(policy?.factBatchSize) ?? DEFAULT_FACT_BATCH_SIZE;

export const scheduleProjectGraphLlmRequest = async <T>(
  work: () => Promise<T>,
  policy?: ProjectGraphLlmRequestPolicy,
): Promise<T> => {
  const delayMs = nonNegativeInteger(policy?.requestDelayMs) ?? DEFAULT_REQUEST_DELAY_MS;
  const queued = requestQueue.then(async () => {
    await waitForLlmSlot(delayMs);
    return work();
  });
  requestQueue = queued.then(() => undefined, () => undefined);
  return queued;
};

export const resetProjectGraphLlmRequestPolicyForTests = (): void => {
  requestQueue = Promise.resolve();
  lastRequestAt = 0;
};

const waitForLlmSlot = async (delayMs: number): Promise<void> => {
  if (delayMs <= 0) return;
  const waitMs = Math.max(0, lastRequestAt + delayMs - Date.now());
  if (waitMs > 0) await new Promise((resolve) => setTimeout(resolve, waitMs));
  lastRequestAt = Date.now();
};

const positiveInteger = (value: number | undefined): number | undefined =>
  typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : undefined;

const nonNegativeInteger = (value: number | undefined): number | undefined =>
  typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : undefined;
