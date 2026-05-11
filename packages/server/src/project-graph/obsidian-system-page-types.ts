/**
 * Shared types for the Obsidian system page generators.
 *
 * Pulled out so the locale-specific generators (`obsidian-system-pages-en`,
 * `obsidian-system-pages-zh`) can stay free of cross-imports back into
 * `project-graph-obsidian-projection.ts`.
 */

export interface SystemPageDefinition {
  key: string;
  name: string;
  title: string;
  body: string[];
  overlays: string[];
  userNotesPlaceholder: string;
  userNotesTitle: string;
  overlayTitle: string;
}
