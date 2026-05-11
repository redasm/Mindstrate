/**
 * System-page internalization.
 *
 * Bridges the gap between `obsidian-system-pages-{en,zh}.ts` (Markdown
 * rendered for humans) and the ECS graph (knowledge MCP retrieval can
 * actually search). Without this step the architecture book lives only
 * as files; `mindstrate_context_assemble` and `search_graph_knowledge`
 * cannot recall a single sentence of it.
 *
 * Each `SystemPageDefinition` becomes a deterministic `RULE` node:
 *   - id: `architecture:system-page:<project>:<page-key>`
 *   - substrateType: RULE, domainType: ARCHITECTURE, status: VERIFIED
 *   - content: the page body (the same Markdown the human reads)
 *   - tags: classifications + page-supplied tags + canonical tags
 *           (`architecture`, `system-page`)
 *   - metadata: structured fields used by `task-report` to render
 *     "Known Constraints" / "Do Not Edit Directly" / "Affected Chains"
 *     / "Recommended Verification".
 *
 * Idempotent: running twice with the same definitions is a no-op (the
 * deterministic id is updated only when the content actually changes).
 *
 * Counterpart consumer: `system-page-rule-lookup.ts` reads these nodes
 * back during MCP task report generation.
 */

import {
  ContextDomainType,
  ContextNodeStatus,
  SubstrateType,
  type ContextNode,
} from '@mindstrate/protocol/models';
import type { ContextGraphStore } from '../context-graph/context-graph-store.js';
import type { SystemPageDefinition } from './obsidian-system-page-types.js';

export const SYSTEM_PAGE_RULE_TAG = 'system-page';
export const SYSTEM_PAGE_RULE_ID_PREFIX = 'architecture:system-page:';

export const systemPageRuleId = (projectName: string, pageKey: string): string =>
  `${SYSTEM_PAGE_RULE_ID_PREFIX}${projectName}:${pageKey}`;

export interface InternalizeSystemPagesResult {
  /** Total number of pages handled (matches input length). */
  pagesProcessed: number;
  /** RULE nodes that were created in this run. */
  created: ContextNode[];
  /** RULE nodes whose content/tags/metadata were updated in this run. */
  updated: ContextNode[];
  /** RULE nodes that already matched the page definition exactly. */
  unchanged: ContextNode[];
  /**
   * RULE nodes from the deprecated `obsidian-architecture:<project>:*`
   * importer (an earlier two-way bridge that has been removed). They are
   * pruned here because their continued presence used to cause
   * `obsidian-sync`'s VaultExporter to emit duplicate
   * `<title>--<idHash>.md` files in the vault root next to the
   * canonical `00-overview.md` ... `07-risky-files.md` system pages.
   */
  prunedLegacy: string[];
}

const LEGACY_OBSIDIAN_ARCHITECTURE_ID_PREFIX = 'obsidian-architecture:';

/**
 * Upsert one `RULE` + `ARCHITECTURE` node per system page.
 *
 * Diffs against the existing node (if any) by content + title + tags +
 * metadata so this can be called every projection write without
 * touching unchanged pages.
 */
export const internalizeSystemPagesAsRules = (
  store: ContextGraphStore,
  projectName: string,
  pages: SystemPageDefinition[],
): InternalizeSystemPagesResult => {
  const result: InternalizeSystemPagesResult = {
    pagesProcessed: pages.length,
    created: [],
    updated: [],
    unchanged: [],
    prunedLegacy: pruneLegacyArchitectureRules(store, projectName),
  };

  for (const page of pages) {
    const id = systemPageRuleId(projectName, page.key);
    const desired = renderSystemPageRule(projectName, page);
    const existing = store.getNodeById(id);

    if (!existing) {
      const created = store.createNode({
        id,
        substrateType: SubstrateType.RULE,
        domainType: ContextDomainType.ARCHITECTURE,
        title: desired.title,
        content: desired.content,
        tags: desired.tags,
        project: projectName,
        compressionLevel: 0.1,
        confidence: 0.95,
        qualityScore: 95,
        status: ContextNodeStatus.VERIFIED,
        sourceRef: `system-page:${page.key}`,
        metadata: desired.metadata,
      });
      result.created.push(created);
      continue;
    }

    if (systemPageRuleMatches(existing, desired)) {
      result.unchanged.push(existing);
      continue;
    }

    const updated = store.updateNode(id, {
      title: desired.title,
      content: desired.content,
      tags: desired.tags,
      project: projectName,
      status: ContextNodeStatus.VERIFIED,
      sourceRef: `system-page:${page.key}`,
      metadata: desired.metadata,
    });
    if (updated) result.updated.push(updated);
  }

  return result;
};

interface DesiredSystemPageRule {
  title: string;
  content: string;
  tags: string[];
  metadata: Record<string, unknown>;
}

const renderSystemPageRule = (projectName: string, page: SystemPageDefinition): DesiredSystemPageRule => {
  const pageMetadata = page.metadata ?? {};
  const tags = uniqueStrings([
    'architecture',
    SYSTEM_PAGE_RULE_TAG,
    `system-page:${page.key}`,
    ...(pageMetadata.tags ?? []),
    ...(pageMetadata.classifications ?? []),
  ]);

  // Persist the structured metadata on the node so `task-report` can read
  // it back without parsing the Markdown body.
  const metadata: Record<string, unknown> = {
    systemPage: true,
    pageKey: page.key,
    pageName: page.name,
  };
  if (pageMetadata.classifications?.length) metadata['classifications'] = pageMetadata.classifications;
  if (pageMetadata.knownConstraints?.length) metadata['knownConstraints'] = pageMetadata.knownConstraints;
  if (pageMetadata.doNotEditTargets?.length) metadata['doNotEditTargets'] = pageMetadata.doNotEditTargets;
  if (pageMetadata.affectedChain) metadata['affectedChain'] = pageMetadata.affectedChain;
  if (pageMetadata.recommendedVerification?.length) metadata['recommendedVerification'] = pageMetadata.recommendedVerification;

  return {
    title: page.title,
    content: page.body.join('\n'),
    tags,
    metadata,
  };
};

const systemPageRuleMatches = (existing: ContextNode, desired: DesiredSystemPageRule): boolean =>
  existing.title === desired.title
    && existing.content.trim() === desired.content.trim()
    && setEquals(new Set(existing.tags), new Set(desired.tags))
    && stableJson(stripGraphVersion(existing.metadata ?? {})) === stableJson(desired.metadata);

/**
 * `ContextNodeRepository` injects a `graphVersion` integer into every
 * metadata blob it persists; the desired blob doesn't carry it. Strip
 * before comparing so an idempotent run does not look like an update.
 */
const stripGraphVersion = (metadata: Record<string, unknown>): Record<string, unknown> => {
  const { graphVersion: _ignored, ...rest } = metadata;
  return rest;
};

const uniqueStrings = (values: string[]): string[] =>
  Array.from(new Set(values.filter(Boolean)));

const setEquals = (a: Set<string>, b: Set<string>): boolean => {
  if (a.size !== b.size) return false;
  for (const value of a) if (!b.has(value)) return false;
  return true;
};

const stableJson = (value: Record<string, unknown>): string => {
  const sorted: Record<string, unknown> = {};
  for (const key of Object.keys(value).sort()) sorted[key] = value[key];
  return JSON.stringify(sorted);
};

/**
 * Prune RULE nodes that the removed `importPlainArchitectureMarkdown`
 * pathway used to create. Their ids look like
 * `obsidian-architecture:<project>:*` and they used to compete with the
 * canonical `architecture:system-page:<project>:*` nodes, doubling up
 * the architecture book in the vault every time `obsidian-sync`
 * exported.
 */
const pruneLegacyArchitectureRules = (store: ContextGraphStore, projectName: string): string[] => {
  const candidates = store.listNodes({
    project: projectName,
    substrateType: SubstrateType.RULE,
    domainType: ContextDomainType.ARCHITECTURE,
    limit: 1000,
  });
  const pruned: string[] = [];
  for (const node of candidates) {
    if (!node.id.startsWith(LEGACY_OBSIDIAN_ARCHITECTURE_ID_PREFIX)) continue;
    if (store.deleteNode(node.id)) pruned.push(node.id);
  }
  return pruned;
};
