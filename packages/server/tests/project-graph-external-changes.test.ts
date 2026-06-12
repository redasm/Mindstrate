import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  ChangeSource,
  ContextDomainType,
  ContextNodeStatus,
  PROJECT_GRAPH_METADATA_KEYS,
  ProjectGraphNodeKind,
  ProjectGraphProvenance,
  SubstrateType,
} from '@mindstrate/protocol/models';
import { ContextGraphStore } from '../src/context-graph/context-graph-store.js';
import {
  detectProjectGraphChanges,
  readExternalChangeMarker,
  recordProjectGraphExternalChanges,
} from '../src/project-graph/index.js';
import type { DetectedProject } from '../src/project/index.js';

const PROJECT = 'ue-game';

describe('recordProjectGraphExternalChanges', () => {
  let db: Database.Database;
  let store: ContextGraphStore;

  beforeEach(() => {
    db = new Database(':memory:');
    store = new ContextGraphStore(db);
  });

  afterEach(() => {
    db.close();
  });

  const createGraphNode = (kind: ProjectGraphNodeKind, title: string, ownedByFile?: string) =>
    store.createNode({
      substrateType: SubstrateType.SNAPSHOT,
      domainType: ContextDomainType.ARCHITECTURE,
      title,
      content: `${kind}: ${title}`,
      project: PROJECT,
      status: ContextNodeStatus.ACTIVE,
      sourceRef: ownedByFile,
      metadata: {
        [PROJECT_GRAPH_METADATA_KEYS.projectGraph]: true,
        [PROJECT_GRAPH_METADATA_KEYS.kind]: kind,
        [PROJECT_GRAPH_METADATA_KEYS.provenance]: ProjectGraphProvenance.EXTRACTED,
        ...(ownedByFile ? { [PROJECT_GRAPH_METADATA_KEYS.ownedByFile]: ownedByFile } : {}),
      },
    });

  it('stamps affected nodes and the project node, counting change events not files', () => {
    const projectNode = createGraphNode(ProjectGraphNodeKind.PROJECT, PROJECT);
    const fileNode = createGraphNode(ProjectGraphNodeKind.FILE, 'Source/Game/Player.cpp', 'Source/Game/Player.cpp');
    const untouched = createGraphNode(ProjectGraphNodeKind.FILE, 'Source/Game/Enemy.cpp', 'Source/Game/Enemy.cpp');

    const first = recordProjectGraphExternalChanges(store, {
      project: PROJECT,
      source: ChangeSource.P4,
      files: ['Source\\Game\\Player.cpp', 'Source/Game/NewFile.cpp'],
      externalRef: 'p4@101',
    });

    expect(first.markedNodeIds).toEqual([fileNode.id]);
    expect(first.unmatchedFiles).toBe(1);

    const second = recordProjectGraphExternalChanges(store, {
      project: PROJECT,
      source: ChangeSource.P4,
      files: ['Source/Game/Player.cpp'],
      externalRef: 'p4@102',
    });
    expect(second.markedNodeIds).toEqual([fileNode.id]);

    const fileMarker = readExternalChangeMarker(store.getNodeById(fileNode.id)!);
    expect(fileMarker).toMatchObject({ pendingChanges: 2, lastSource: 'p4', lastExternalRef: 'p4@102' });

    const projectMarker = readExternalChangeMarker(store.getNodeById(projectNode.id)!);
    expect(projectMarker?.pendingChanges).toBe(2);

    expect(readExternalChangeMarker(store.getNodeById(untouched.id)!)).toBeNull();
  });

  it('reports all files unmatched when the project has no indexed graph', () => {
    const result = recordProjectGraphExternalChanges(store, {
      project: 'never-indexed',
      source: ChangeSource.GIT,
      files: ['src/a.ts'],
    });
    expect(result.markedNodeIds).toEqual([]);
    expect(result.unmatchedFiles).toBe(1);
  });

  it('surfaces staleness markers as risk hints in change detection', () => {
    createGraphNode(ProjectGraphNodeKind.PROJECT, PROJECT);
    createGraphNode(ProjectGraphNodeKind.FILE, 'Source/Game/Player.cpp', 'Source/Game/Player.cpp');

    recordProjectGraphExternalChanges(store, {
      project: PROJECT,
      source: ChangeSource.P4,
      files: ['Source/Game/Player.cpp'],
      externalRef: 'p4@101',
    });

    const project = { name: PROJECT, root: '/tmp/ue-game' } as DetectedProject;
    const result = detectProjectGraphChanges(store, project, {
      source: ChangeSource.MANUAL,
      files: ['Source/Game/Player.cpp'],
    });

    expect(result.riskHints.some((hint) => hint.includes('may be stale') && hint.includes('Source/Game/Player.cpp'))).toBe(true);
    expect(result.riskHints.some((hint) => hint.includes('indexed before 1 upstream change event'))).toBe(true);
  });

  it('does not emit staleness hints for projects without markers', () => {
    createGraphNode(ProjectGraphNodeKind.PROJECT, PROJECT);
    createGraphNode(ProjectGraphNodeKind.FILE, 'Source/Game/Player.cpp', 'Source/Game/Player.cpp');

    const project = { name: PROJECT, root: '/tmp/ue-game' } as DetectedProject;
    const result = detectProjectGraphChanges(store, project, {
      source: ChangeSource.MANUAL,
      files: ['Source/Game/Player.cpp'],
    });

    expect(result.riskHints.every((hint) => !hint.includes('stale') && !hint.includes('outdated'))).toBe(true);
  });
});
