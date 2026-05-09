import type { ProjectGraphOverlay } from '@mindstrate/protocol/models';

export interface ProjectGraphArtifactResult {
  reportPath: string;
  statsPath: string;
  graphPath: string;
  modulePaths: string[];
  nodePaths: string[];
  nodes: number;
  edges: number;
}

export interface ProjectGraphStatsExport {
  project: string;
  generatedAt: string;
  nodes: number;
  edges: number;
  projectionNodeId?: string;
  firstFiles: string[];
  highImpactFiles: ProjectGraphReportItem[];
  entryPoints: ProjectGraphReportItem[];
  coreModules: ProjectGraphReportItem[];
  assetSurfaces: ProjectGraphReportItem[];
  bindingSurfaces: ProjectGraphReportItem[];
  overlays: ProjectGraphOverlay[];
  inferredSummaries: Array<{
    title: string;
    summary: string;
    provenance: string;
    evidencePaths: string[];
  }>;
  openQuestions: Array<{
    title: string;
    summary: string;
    evidencePaths: string[];
  }>;
  provenanceCounts: Record<string, number>;
  nodeKindCounts: Record<string, number>;
}

export interface ProjectGraphReportItem {
  label: string;
  evidencePaths: string[];
  impactTags?: string[];
}
