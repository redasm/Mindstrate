/**
 * Native ↔ script binding fact builders.
 *
 * Two passes that run after raw extraction:
 *   - `addBindingFacts`: heuristically connect native CLASS/FUNCTION nodes to
 *     DEPENDENCY nodes that look like script-side calls of the same symbol.
 *   - `addGeneratedBindingFacts`: connect generated FILE nodes back to the
 *     native symbol they were generated from (same base name).
 *
 * Lives separately from `project-graph-service.ts` because it is a distinct
 * second-pass concern, not an extractor.
 */

import {
  ProjectGraphEdgeKind,
  ProjectGraphNodeKind,
  type ProjectGraphEdgeDto,
  type ProjectGraphNodeDto,
} from '@mindstrate/protocol/models';
import * as path from 'node:path';
import {
  addEdge,
  makeEdge,
  normalizeSymbolName,
} from './project-graph-fact-builder.js';

export const addBindingFacts = (
  nodes: Map<string, ProjectGraphNodeDto>,
  edges: Map<string, ProjectGraphEdgeDto>,
): void => {
  const nativeSymbols = Array.from(nodes.values())
    .filter((node) => node.kind === ProjectGraphNodeKind.CLASS || node.kind === ProjectGraphNodeKind.FUNCTION);
  const scriptCallsByLabel = new Map<string, ProjectGraphNodeDto[]>();
  for (const node of nodes.values()) {
    if (node.kind !== ProjectGraphNodeKind.DEPENDENCY) continue;
    const key = normalizeSymbolName(node.label).replace(/^u/, '');
    const current = scriptCallsByLabel.get(key) ?? [];
    current.push(node);
    scriptCallsByLabel.set(key, current);
  }
  for (const native of nativeSymbols) {
    const key = normalizeSymbolName(native.label).replace(/^u/, '');
    for (const scriptCall of scriptCallsByLabel.get(key) ?? []) {
      addEdge(edges, makeEdge(native.id, scriptCall.id, ProjectGraphEdgeKind.BINDS_TO, native.evidence));
    }
  }
};

export const addGeneratedBindingFacts = (
  nodes: Map<string, ProjectGraphNodeDto>,
  edges: Map<string, ProjectGraphEdgeDto>,
): void => {
  const generatedFiles = Array.from(nodes.values())
    .filter((node) => node.kind === ProjectGraphNodeKind.FILE && node.metadata?.['generated'] === true);
  const nativeSymbols = Array.from(nodes.values())
    .filter((node) => node.kind === ProjectGraphNodeKind.CLASS || node.kind === ProjectGraphNodeKind.FUNCTION || node.kind === ProjectGraphNodeKind.TYPE);
  for (const generatedFile of generatedFiles) {
    const bindingName = generatedBindingName(generatedFile.label);
    if (!bindingName) continue;
    const source = nativeSymbols.find((node) => generatedBindingMatches(bindingName, node.label));
    if (!source) continue;
    generatedFile.metadata = {
      ...(generatedFile.metadata ?? {}),
      sourceGeneratedFrom: source.id,
    };
    addEdge(edges, makeEdge(generatedFile.id, source.id, ProjectGraphEdgeKind.GENERATED_FROM, generatedFile.evidence));
  }
};

const generatedBindingName = (filePath: string): string | undefined => {
  const base = path.basename(filePath).replace(/\.[^.]+$/, '');
  return base || undefined;
};

const generatedBindingMatches = (bindingName: string, symbolName: string): boolean => {
  const normalizedBinding = normalizeSymbolName(bindingName);
  const normalizedSymbol = normalizeSymbolName(symbolName);
  return normalizedBinding === normalizedSymbol
    || normalizedBinding.replace(/^u/, '') === normalizedSymbol.replace(/^u/, '');
};
