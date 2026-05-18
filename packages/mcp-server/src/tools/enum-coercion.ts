/**
 * Enum coercion for MCP tool inputs.
 *
 * Protocol enums (`SubstrateType`, `ContextDomainType`, `ContextNodeStatus`,
 * `ContextRelationType`, ...) carry uppercase TypeScript member names
 * (`SubstrateType.RULE`) but lowercase string values (`'rule'`). Downstream
 * SQLite filters compare against the lowercase value, so when a caller
 * passes the member name verbatim (`substrateType: "RULE"`) the filter
 * silently matches nothing.
 *
 * `coerceContextEnum` normalizes a raw MCP tool input value against any
 * protocol enum object so the caller-facing API stays forgiving (both
 * `"RULE"` and `"rule"` work) without each handler re-implementing the
 * lookup. Unknown values pass through unchanged; downstream validators
 * still get to reject them with their domain-specific error message.
 */

export const coerceContextEnum = <T extends Record<string, string>>(
  enumObject: T,
  value: string | undefined,
): T[keyof T] | undefined => {
  if (value === undefined || value === null) return undefined;
  const validValues = new Set(Object.values(enumObject));
  if (validValues.has(value)) return value as T[keyof T];
  const lowered = value.toLowerCase();
  if (validValues.has(lowered)) return lowered as T[keyof T];
  return value as T[keyof T];
};
