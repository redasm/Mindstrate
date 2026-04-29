import type { McpApi, McpToolResponse } from '../types.js';

type ToolInput = any;

export async function handleBundleCreate(
  api: McpApi,
  input: ToolInput,
): Promise<McpToolResponse> {
  const bundle = await api.createBundle(input);
  return {
    content: [{
      type: 'text',
      text: `Bundle created.\nID: ${bundle.id}\nName: ${bundle.name}\nNodes: ${bundle.nodeIds.length}\nEdges: ${bundle.edgeIds.length}`,
    }],
  };
}

export async function handleBundleValidate(
  api: McpApi,
  input: ToolInput,
): Promise<McpToolResponse> {
  const result = await api.validateBundle(input.bundle);
  return {
    content: [{
      type: 'text',
      text: result.valid
        ? 'Bundle is valid.'
        : `Bundle validation failed:\n${result.errors.map((error) => `- ${error}`).join('\n')}`,
    }],
    isError: result.valid ? undefined : true,
  };
}

export async function handleBundleInstall(
  api: McpApi,
  input: ToolInput,
): Promise<McpToolResponse> {
  if (!input.bundle && (!input.registry || !input.reference)) {
    return {
      content: [{
        type: 'text',
        text: 'Bundle install requires either bundle or registry plus reference.',
      }],
      isError: true,
    };
  }

  const result = input.bundle
    ? await api.installBundle(input.bundle)
    : await api.installBundleFromRegistry({
        registry: input.registry!,
        reference: input.reference!,
      });
  return {
    content: [{
      type: 'text',
      text: `Bundle installed.\nInstalled nodes: ${result.installedNodes}\nUpdated nodes: ${result.updatedNodes}\nInstalled edges: ${result.installedEdges}\nSkipped edges: ${result.skippedEdges}`,
    }],
  };
}

export async function handleBundlePublish(
  api: McpApi,
  input: ToolInput,
): Promise<McpToolResponse> {
  const result = await api.publishBundle(input.bundle, {
    registry: input.registry,
    visibility: input.visibility,
  });

  return {
    content: [{
      type: 'text',
      text: [
        'Bundle publication manifest:',
        `ID: ${result.manifest.id}`,
        `Name: ${result.manifest.name}`,
        `Version: ${result.manifest.version}`,
        `Registry: ${result.manifest.registry}`,
        `Visibility: ${result.manifest.visibility}`,
        `Nodes: ${result.manifest.nodeCount}`,
        `Edges: ${result.manifest.edgeCount}`,
        `Digest: ${result.manifest.digest}`,
      ].join('\n'),
    }],
  };
}
