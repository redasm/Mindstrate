import type { ContextNode } from '@mindstrate/protocol/models';

/**
 * Read a string-typed nested metadata value from a ContextNode, returning ''
 * when the path is missing or the value is not a string. Centralizes the
 * defensive lookup pattern so callers don't repeat the type narrowing.
 */
export const getStringMetadata = (
  node: ContextNode,
  objectKey: string,
  valueKey: string,
): string => {
  const value = node.metadata?.[objectKey];
  if (!value || typeof value !== 'object' || Array.isArray(value)) return '';
  const nested = (value as Record<string, unknown>)[valueKey];
  return typeof nested === 'string' ? nested : '';
};
