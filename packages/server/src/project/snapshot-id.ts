import * as crypto from 'node:crypto';
import * as path from 'node:path';
import type { DetectedProject } from './detector.js';

export const projectSnapshotId = (project: DetectedProject): string => {
  const normalizedRoot = path.resolve(project.root).replace(/\\/g, '/').toLowerCase();
  const signature = `mindstrate:project-snapshot:${normalizedRoot}:${project.name}`;
  const hash = crypto.createHash('sha1').update(signature).digest('hex');

  return [
    hash.slice(0, 8),
    hash.slice(8, 12),
    `5${hash.slice(13, 16)}`,
    `8${hash.slice(17, 20)}`,
    hash.slice(20, 32),
  ].join('-');
};

