/**
 * Mindstrate instance factory for the CLI.
 *
 * Centralizes how the CLI commands obtain a Mindstrate handle so that
 * future configuration (env-driven defaults, alternate vector backends,
 * etc.) lives in one place instead of being duplicated across command
 * files.
 */

import { Mindstrate, detectProject } from '@mindstrate/server';
import { loadProjectEnv } from './cli-config.js';

/**
 * 创建一个 CLI 用的 `Mindstrate` 实例。
 *
 * `cwd` 决定从哪里探测项目根目录并加载该项目的 `.env`：
 * - 显式传入：用于 `-C, --cwd` 选项支持的命令；
 * - 省略：使用 `process.cwd()`（适用于直接在项目目录执行的场景）；
 * - 探测不到项目（比如全局调用、无 `package.json` 等）：跳过 env 加载，但仍返回
 *   一个使用 shell env / 全局默认的 `Mindstrate`，因此 mcp-server 等无项目场景也能用。
 *
 * 注意：本工厂**依赖 cwd**，不再是“纯工厂”——`createMemory()` 与 `createMemory('/x')`
 * 可能加载不同的 .env，从而影响后续 `Mindstrate` 实例的 LLM/embedding 配置。
 */
export function createMemory(cwd = process.cwd()): Mindstrate {
  const project = detectProject(cwd);
  if (project) loadProjectEnv(project.root);
  return new Mindstrate();
}
