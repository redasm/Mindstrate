export { errorMessage, truncateText } from '@mindstrate/protocol/text';

export const slugifyAscii = (value: string, fallback = 'untitled'): string => (
  value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || fallback
);
