import * as fs from 'node:fs';
import * as path from 'node:path';

export const writeProjectGraphTextFileAtomically = (filePath: string, content: string): void => {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tempPath = path.join(
    path.dirname(filePath),
    `.${path.basename(filePath)}.tmp-${process.pid}-${Date.now()}`,
  );
  fs.writeFileSync(tempPath, content, 'utf8');
  fs.renameSync(tempPath, filePath);
};
