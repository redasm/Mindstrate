export const errorMessage = (error: unknown, fallback = 'Unknown error'): string => (
  error instanceof Error ? error.message : fallback
);

export const truncateText = (value: string, maxLength: number, suffix = '...'): string => {
  if (value.length <= maxLength) return value;
  if (maxLength <= suffix.length) return suffix.slice(0, maxLength);
  return `${value.slice(0, maxLength - suffix.length)}${suffix}`;
};
