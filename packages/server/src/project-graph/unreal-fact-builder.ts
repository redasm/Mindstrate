/**
 * Unreal-specific project graph fact builders.
 *
 * Encapsulates everything that is specific to the Unreal Engine surface:
 *   - Asset registry import → asset/component/reference nodes.
 *   - Build module facts from `*.Build.cs` and Unreal target descriptors.
 *   - Manifest facts from `.uproject` / `.uplugin`.
 *   - Config reference facts from `Config/**.ini`.
 *   - Module dependency edges with public/private scope.
 *
 * Lifted out of `project-graph-service.ts` so the orchestrator stays focused
 * on indexing flow rather than per-engine recipes.
 */

import {
  ProjectGraphEdgeKind,
  ProjectGraphNodeKind,
  type EvidenceRef,
  type ProjectGraphEdgeDto,
  type ProjectGraphNodeDto,
} from '@mindstrate/protocol/models';
import type { DetectedProject } from '../project/index.js';
import {
  addEdge,
  addNode,
  evidence,
  fileNodeId,
  impactTags,
  makeEdge,
  makeNode,
} from './project-graph-fact-builder.js';
import type { ParserCapture } from './parser-adapter.js';
import { readUnrealAssetRegistryExport } from './unreal-asset-registry-importer.js';
import {
  extractUnrealBuildModuleDependencies,
  extractUnrealBuildModuleInfo,
  extractUnrealConfigReferences,
  extractUnrealManifestInfo,
} from './unreal-extractor.js';

// ============================================================
// Module node helpers
// ============================================================

const unrealModuleImpactMetadata = (moduleType: unknown): Record<string, unknown> => {
  if (typeof moduleType !== 'string') return {};
  const editorOnly = moduleType.toLowerCase().includes('editor');
  return {
    runtimeModule: !editorOnly,
    editorOnly,
    ...impactTags(editorOnly ? 'editor-only' : 'runtime-module'),
  };
};

export const makeUnrealModuleNode = (
  project: DetectedProject,
  name: string,
  nodeEvidence: EvidenceRef[],
  metadata?: Record<string, unknown>,
): ProjectGraphNodeDto => makeNode(project, ProjectGraphNodeKind.MODULE, `unreal-module:${name}`, name, nodeEvidence, {
  unrealModule: true,
  ...unrealModuleImpactMetadata(metadata?.['moduleType']),
  ...(metadata ?? {}),
});

// ============================================================
// Asset registry → graph facts
// ============================================================

export const addUnrealAssetRegistryFacts = (
  project: DetectedProject,
  nodes: Map<string, ProjectGraphNodeDto>,
  edges: Map<string, ProjectGraphEdgeDto>,
): void => {
  const registry = readUnrealAssetRegistryExport(project.root);
  if (!registry) return;
  for (const asset of registry.assets) {
    const assetNode = makeNode(project, ProjectGraphNodeKind.COMPONENT, asset.path, asset.path, evidence(asset.path), {
      assetClass: asset.class,
      scanMode: 'metadata-only',
      assetReferenceSensitive: true,
      ...impactTags('asset-reference-sensitive'),
    });
    addNode(nodes, assetNode);
    if (asset.parent) {
      const parentNode = makeNode(project, ProjectGraphNodeKind.CLASS, asset.parent, asset.parent, evidence(asset.path), {
        assetParent: true,
      });
      addNode(nodes, parentNode);
      addEdge(edges, makeEdge(assetNode.id, parentNode.id, ProjectGraphEdgeKind.DEPENDS_ON, evidence(asset.path)));
    }
    for (const reference of asset.references ?? []) {
      const referenceNode = makeNode(project, ProjectGraphNodeKind.COMPONENT, reference.path, reference.path, evidence(asset.path), {
        scanMode: 'metadata-only',
        assetReferenceSensitive: true,
        ...impactTags('asset-reference-sensitive'),
      });
      addNode(nodes, referenceNode);
      addEdge(edges, makeEdge(assetNode.id, referenceNode.id, ProjectGraphEdgeKind.REFERENCES_ASSET, evidence(asset.path), {
        referenceType: reference.type,
      }));
    }
  }
};

// ============================================================
// `*.Build.cs` and `*.Target.cs`
// ============================================================

export const addUnrealBuildFacts = (
  project: DetectedProject,
  filePath: string,
  content: string,
  nodes: Map<string, ProjectGraphNodeDto>,
  edges: Map<string, ProjectGraphEdgeDto>,
  dependencyScopeFromCapture: (capture: ParserCapture) => 'public' | 'private',
): void => {
  const moduleInfo = extractUnrealBuildModuleInfo({ path: filePath, content });
  const moduleNode = makeUnrealModuleNode(project, moduleInfo.moduleName, evidence(filePath), {
    declaredIn: filePath,
    dependencySurface: {
      public: moduleInfo.publicDependencies,
      private: moduleInfo.privateDependencies,
    },
  });
  addNode(nodes, moduleNode);
  addEdge(edges, makeEdge(fileNodeId(project, filePath), moduleNode.id, ProjectGraphEdgeKind.DECLARES_MODULE, evidence(filePath), {
    declarationSource: 'build-module',
  }));
  for (const capture of extractUnrealBuildModuleDependencies({ path: filePath, content })) {
    addUnrealModuleDependencyFact(project, filePath, capture.text, moduleNode.id, nodes, edges, dependencyScopeFromCapture(capture), capture);
  }
};

const addUnrealModuleDependencyFact = (
  project: DetectedProject,
  filePath: string,
  name: string,
  moduleNodeId: string,
  nodes: Map<string, ProjectGraphNodeDto>,
  edges: Map<string, ProjectGraphEdgeDto>,
  dependencyScope: 'public' | 'private',
  capture: ParserCapture,
): void => {
  if (!name) return;
  const dependency = makeNode(project, ProjectGraphNodeKind.DEPENDENCY, `unreal-module:${name}`, name, evidence(filePath, capture), {
    unrealModuleDependency: true,
  });
  addNode(nodes, dependency);
  const edgeMetadata = {
    dependencyKind: 'unreal-module',
    dependencyScope,
  };
  addEdge(edges, makeEdge(fileNodeId(project, filePath), dependency.id, ProjectGraphEdgeKind.DEPENDS_ON, evidence(filePath, capture), edgeMetadata));
  addEdge(edges, makeEdge(moduleNodeId, dependency.id, ProjectGraphEdgeKind.DEPENDS_ON, evidence(filePath, capture), edgeMetadata));
};

// ============================================================
// `.uproject` / `.uplugin`
// ============================================================

export const addUnrealManifestFacts = (
  project: DetectedProject,
  filePath: string,
  content: string,
  nodes: Map<string, ProjectGraphNodeDto>,
  edges: Map<string, ProjectGraphEdgeDto>,
): void => {
  const manifest = extractUnrealManifestInfo({ path: filePath, content });
  if (!manifest) return;
  for (const moduleInfo of manifest.modules) {
    const moduleNode = makeUnrealModuleNode(project, moduleInfo.name, evidence(filePath), {
      manifestType: manifest.type,
      moduleType: moduleInfo.type,
      loadingPhase: moduleInfo.loadingPhase,
      declaredIn: filePath,
    });
    addNode(nodes, moduleNode);
    addEdge(edges, makeEdge(fileNodeId(project, filePath), moduleNode.id, ProjectGraphEdgeKind.DECLARES_MODULE, evidence(filePath), {
      declarationSource: manifest.type === 'plugin' ? 'plugin-manifest' : 'project-manifest',
      moduleType: moduleInfo.type,
      loadingPhase: moduleInfo.loadingPhase,
    }));
    addEdge(edges, makeEdge(fileNodeId(project, filePath), moduleNode.id, ProjectGraphEdgeKind.LOADS_MODULE, evidence(filePath), {
      moduleType: moduleInfo.type,
      loadingPhase: moduleInfo.loadingPhase,
    }));
  }
  for (const plugin of manifest.pluginDependencies) {
    const dependency = makeNode(project, ProjectGraphNodeKind.DEPENDENCY, `unreal-plugin:${plugin.name}`, plugin.name, evidence(filePath), {
      unrealPlugin: true,
      enabled: plugin.enabled,
    });
    addNode(nodes, dependency);
    addEdge(edges, makeEdge(fileNodeId(project, filePath), dependency.id, ProjectGraphEdgeKind.DEPENDS_ON, evidence(filePath), {
      dependencyKind: 'unreal-plugin',
      enabled: plugin.enabled,
    }));
  }
};

// ============================================================
// `Config/**.ini`
// ============================================================

export const addUnrealConfigFacts = (
  project: DetectedProject,
  filePath: string,
  content: string,
  nodes: Map<string, ProjectGraphNodeDto>,
  edges: Map<string, ProjectGraphEdgeDto>,
): void => {
  for (const capture of extractUnrealConfigReferences({ path: filePath, content })) {
    if (capture.name === 'unreal.config.class') {
      addConfigReferenceFact(project, filePath, capture.text, ProjectGraphNodeKind.CLASS, nodes, edges, capture);
    } else {
      addConfigReferenceFact(project, filePath, capture.text, ProjectGraphNodeKind.DEPENDENCY, nodes, edges, capture);
    }
  }
};

const addConfigReferenceFact = (
  project: DetectedProject,
  filePath: string,
  name: string,
  kind: ProjectGraphNodeKind.CLASS | ProjectGraphNodeKind.DEPENDENCY,
  nodes: Map<string, ProjectGraphNodeDto>,
  edges: Map<string, ProjectGraphEdgeDto>,
  capture: ParserCapture,
): void => {
  if (!name) return;
  const target = makeNode(project, kind, `${capture.name}:${name}`, name, evidence(filePath, capture), {
    configuredBy: filePath,
    configReferenceKind: capture.name,
    configSensitive: true,
    ...impactTags('config-sensitive'),
  });
  addNode(nodes, target);
  addEdge(edges, makeEdge(fileNodeId(project, filePath), target.id, ProjectGraphEdgeKind.CONFIGURES, evidence(filePath, capture), {
    configReferenceKind: capture.name,
  }));
};
