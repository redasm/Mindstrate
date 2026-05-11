/**
 * Mindstrate runtime logger contract.
 *
 * Library code (`@mindstrate/server`) MUST NOT call `console.*` directly.
 * The MCP server runs as a JSON-RPC peer over stdio; any stray write to
 * `process.stdout` (or even `process.stderr` in some clients) corrupts the
 * protocol stream. Application packages (CLI, web-ui, team-server) keep
 * stdio for humans, so they explicitly install a console-backed logger;
 * embedded hosts (mcp-server) install `noopLogger` and surface diagnostics
 * through their own channel.
 */
export interface Logger {
  warn(message: string, meta?: Record<string, unknown>): void;
  error(message: string, meta?: Record<string, unknown>): void;
  info?(message: string, meta?: Record<string, unknown>): void;
  debug?(message: string, meta?: Record<string, unknown>): void;
}

export const noopLogger: Logger = {
  warn: () => {},
  error: () => {},
  info: () => {},
  debug: () => {},
};

export const consoleLogger: Logger = {
  warn: (message, meta) => meta ? console.warn(message, meta) : console.warn(message),
  error: (message, meta) => meta ? console.error(message, meta) : console.error(message),
  info: (message, meta) => meta ? console.info(message, meta) : console.info(message),
  debug: (message, meta) => meta ? console.debug(message, meta) : console.debug(message),
};
