/**
 * Shared types for the Obsidian system page generators.
 *
 * Pulled out so the locale-specific generators (`obsidian-system-pages-en`,
 * `obsidian-system-pages-zh`) can stay free of cross-imports back into
 * `project-graph-obsidian-projection.ts`.
 *
 * `SystemPageDefinition` doubles as the source of truth for two
 * downstream consumers:
 *   1. The Obsidian projection writer turns it into a Markdown page.
 *   2. The system-page internalizer (`internalize-system-pages.ts`) turns
 *      it into a deterministic `RULE` node so MCP retrieval (assemble /
 *      query_project_graph_task / search_graph_knowledge) can recall it.
 *
 * The `metadata` block carries the structured fields the second consumer
 * needs. Keep it free of any UI / Markdown formatting; render-time
 * concerns belong in the projection writer.
 */

/**
 * Classification labels shared with `task-report.classifyTargets`.
 *
 * When a task report's `classifications` set intersects a system page's
 * `metadata.classifications`, that page's `knownConstraints` /
 * `doNotEditTargets` / `affectedChain` / `recommendedVerification` are
 * surfaced as the "Known Constraints" / "Do Not Edit Directly" / etc.
 * sections. Adding a new classification here is the contract change that
 * lights up new Markdown pages in the MCP report.
 */
export type SystemPageClassification =
  | 'generated-output'
  | 'project-manifest'
  | 'plugin-manifest'
  | 'build-module'
  | 'editor-boundary'
  | 'asset-reference-sensitive'
  | 'config-sensitive'
  | 'native-script-binding'
  | 'typescript-consumer'
  | 'cpp-source'
  | 'general-source';

export interface SystemPageMetadata {
  /** Which classification(s) this page is an authoritative source for. */
  classifications?: SystemPageClassification[];
  /** Sentences pasted into "Known Constraints" of the before-edit report. */
  knownConstraints?: string[];
  /** Targets pasted into "Do Not Edit Directly". */
  doNotEditTargets?: string[];
  /** Sentence pasted into "Affected Chains". */
  affectedChain?: string;
  /**
   * Sentences pasted into "Source Of Truth". When present, the
   * project-specific phrasing wins over the generic
   * "Exact source file and its direct callers/importers." fallback
   * computed from `classifications` alone.
   */
  sourceOfTruth?: string[];
  /** Sentences pasted into "Recommended Verification". */
  recommendedVerification?: string[];
  /** Free-form tags appended to the internalized RULE node. */
  tags?: string[];
}

export interface SystemPageDefinition {
  key: string;
  name: string;
  title: string;
  body: string[];
  overlays: string[];
  userNotesPlaceholder: string;
  userNotesTitle: string;
  overlayTitle: string;
  /**
   * Optional structured metadata. When present, this page becomes a
   * canonical source of project-specific edit guidance for the MCP
   * before-edit / impact reports.
   */
  metadata?: SystemPageMetadata;
  /**
   * Custom pages loaded from `<project>/.mindstrate/system-pages/*.json`
   * remember the source filename so error messages and CLI output can
   * point a human back to the right file. Built-in pages leave it
   * undefined.
   */
  sourceFile?: string;
}
