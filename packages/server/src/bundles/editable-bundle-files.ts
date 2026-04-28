import type { InstallBundleResult } from '@mindstrate/protocol';
import type { PortableContextBundle, PortableContextBundleNode } from '@mindstrate/protocol/models';
import * as fs from 'node:fs';
import * as path from 'node:path';

export type EditableBundleFiles = Record<string, string>;

export interface InstallEditableBundleFilesResult extends InstallBundleResult {
  bundle: PortableContextBundle;
  updatedBundleNodes: number;
}

interface EditableBundleNodeEdit {
  id: string;
  title: string;
  content: string;
}

export const createEditableBundleFiles = (bundle: PortableContextBundle): EditableBundleFiles => ({
  'bundle.json': JSON.stringify(bundle, null, 2),
  'rules.md': formatBundleMarkdown('Rules', bundle.nodes?.filter((node) => node.substrateType === 'rule') ?? []),
  'skills.md': formatBundleMarkdown('Skills', bundle.nodes?.filter((node) => node.substrateType === 'skill') ?? []),
  'invariants.md': formatBundleMarkdown(
    'Invariants',
    bundle.nodes?.filter((node) => ['heuristic', 'axiom'].includes(node.substrateType)) ?? [],
  ),
});

export const installEditableBundleFiles = (
  files: EditableBundleFiles,
  installBundle: (bundle: PortableContextBundle) => InstallBundleResult,
): InstallEditableBundleFilesResult => {
  const bundle = readEditableBundle(files);
  const edits = new Map<string, EditableBundleNodeEdit>();
  for (const fileName of ['rules.md', 'skills.md', 'invariants.md']) {
    for (const edit of parseEditableBundleMarkdown(files[fileName] ?? '')) {
      edits.set(edit.id, edit);
    }
  }

  let updatedBundleNodes = 0;
  const nodes = (bundle.nodes ?? []).map((node) => {
    const edit = edits.get(node.id);
    if (!edit) return node;
    updatedBundleNodes++;
    return {
      ...node,
      title: edit.title,
      content: edit.content,
    };
  });

  const editedBundle = {
    ...bundle,
    nodes,
  };
  const install = installBundle(editedBundle);
  return {
    ...install,
    bundle: editedBundle,
    updatedBundleNodes,
  };
};

export const installEditableBundleDirectory = (
  directory: string,
  installBundle: (bundle: PortableContextBundle) => InstallBundleResult,
): InstallEditableBundleFilesResult => {
  const files: EditableBundleFiles = {};
  for (const fileName of ['bundle.json', 'rules.md', 'skills.md', 'invariants.md']) {
    const filePath = path.join(directory, fileName);
    if (fs.existsSync(filePath)) {
      files[fileName] = fs.readFileSync(filePath, 'utf-8');
    }
  }
  return installEditableBundleFiles(files, installBundle);
};

const formatBundleMarkdown = (
  title: string,
  nodes: PortableContextBundleNode[],
): string => {
  const lines = [`# ${title}`, ''];
  if (nodes.length === 0) {
    lines.push('_No entries in this bundle._');
    return lines.join('\n');
  }

  for (const node of nodes) {
    lines.push(`## ${node.title}`);
    lines.push('');
    lines.push(node.content);
    lines.push('');
    lines.push(`- ID: ${node.id}`);
    lines.push(`- Domain: ${node.domainType}`);
    lines.push(`- Status: ${node.status}`);
    if (node.tags.length > 0) {
      lines.push(`- Tags: ${node.tags.join(', ')}`);
    }
    lines.push('');
  }

  return lines.join('\n').trimEnd() + '\n';
};

const readEditableBundle = (files: EditableBundleFiles): PortableContextBundle => {
  const rawBundle = files['bundle.json'];
  if (!rawBundle) {
    throw new Error('Editable bundle files must include bundle.json');
  }
  return JSON.parse(rawBundle) as PortableContextBundle;
};

const parseEditableBundleMarkdown = (markdown: string): EditableBundleNodeEdit[] => {
  const edits: EditableBundleNodeEdit[] = [];
  const lines = markdown.split(/\r?\n/);
  let index = 0;

  while (index < lines.length) {
    const heading = lines[index].match(/^##\s+(.+?)\s*$/);
    if (!heading) {
      index++;
      continue;
    }

    const title = heading[1].trim();
    index++;
    const contentLines: string[] = [];
    let id: string | undefined;

    while (index < lines.length && !lines[index].startsWith('## ')) {
      const idMatch = lines[index].match(/^-\s+ID:\s*(.+?)\s*$/);
      if (idMatch) {
        id = idMatch[1].trim();
        index++;
        continue;
      }
      if (id) {
        index++;
        continue;
      }
      contentLines.push(lines[index]);
      index++;
    }

    if (id) {
      edits.push({
        id,
        title,
        content: contentLines.join('\n').trim(),
      });
    }
  }

  return edits;
};
