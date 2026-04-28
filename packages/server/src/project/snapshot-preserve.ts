/** Preserve markers - anything between them is kept across re-generations. */
export const PRESERVE_OPEN = '<!-- preserve -->';
export const PRESERVE_CLOSE = '<!-- /preserve -->';

export interface PreservedBlocks {
  architecture?: string;
  invariants?: string;
  conventions?: string;
  notes?: string;
}

export const extractPreserveBlocks = (solution: string): PreservedBlocks => {
  const out: PreservedBlocks = {};
  if (!solution) return out;
  const sectionRe = /^##\s+(.+?)\s*$/gm;
  const headings: Array<{ name: string; index: number }> = [];
  for (const match of solution.matchAll(sectionRe)) {
    headings.push({ name: match[1].trim().toLowerCase(), index: match.index ?? 0 });
  }

  for (let i = 0; i < headings.length; i++) {
    const heading = headings[i];
    const next = headings[i + 1]?.index ?? solution.length;
    const slice = solution.slice(heading.index, next);
    const block = matchPreserveBlock(slice);
    if (!block) continue;
    if (heading.name.startsWith('architecture')) out.architecture = block;
    else if (heading.name.startsWith('critical invariants')) out.invariants = block;
    else if (heading.name.startsWith('conventions')) out.conventions = block;
    else if (heading.name.startsWith('notes')) out.notes = block;
  }

  return out;
};

const matchPreserveBlock = (text: string): string | null => {
  const open = text.indexOf(PRESERVE_OPEN);
  if (open < 0) return null;
  const close = text.indexOf(PRESERVE_CLOSE, open + PRESERVE_OPEN.length);
  if (close < 0) return null;
  return text.slice(open + PRESERVE_OPEN.length, close).replace(/^\n+|\n+$/g, '');
};
