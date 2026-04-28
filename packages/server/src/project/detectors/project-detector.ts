import type { DetectedProject } from '../detector.js';

export interface ProjectDetector {
  detect(root: string): DetectedProject | null;
}

