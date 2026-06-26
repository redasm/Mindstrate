import { NextRequest, NextResponse } from 'next/server';
import type { UpdateLlmConfigInput } from '@mindstrate/protocol';
import { getMemoryReady } from '@/lib/memory';
import { errorResponse } from '@/app/api/error-response';
import { requireAdminFromRequest } from '@/lib/session';

const guard = async (req: NextRequest): Promise<Response | null> => {
  try {
    await requireAdminFromRequest(req);
    return null;
  } catch (resp) {
    return resp as Response;
  }
};

const maskKey = (key: string): string => {
  if (!key) return '';
  if (key.length <= 4) return '••••';
  return `••••${key.slice(-4)}`;
};

// GET returns the full API key so the admin can rotate it; masking happens at the list endpoint.
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const denied = await guard(request); if (denied) return denied;
  try {
    const { id } = await params;
    const memory = await getMemoryReady();
    const config = memory.llmConfigs.getById(id);
    if (!config) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json(config);
  } catch (error) {
    return errorResponse(error);
  }
}

function buildPatch(body: Record<string, unknown>): UpdateLlmConfigInput {
  const patch: UpdateLlmConfigInput = {};
  if (typeof body.openaiApiKey === 'string' && body.openaiApiKey !== '') {
    patch.openaiApiKey = body.openaiApiKey;
  }
  // embeddingApiKey is nullable: explicit null/"" clears it (fall back to main key).
  if ('embeddingApiKey' in body) {
    const value = body.embeddingApiKey;
    if (value === null) patch.embeddingApiKey = null;
    else if (typeof value === 'string' && !value.startsWith('••••')) {
      const trimmed = value.trim();
      patch.embeddingApiKey = trimmed === '' ? null : trimmed;
    }
  }
  for (const key of ['llmBaseUrl', 'embeddingBaseUrl'] as const) {
    if (!(key in body)) continue;
    const value = body[key];
    if (value === null) patch[key] = null;
    else if (typeof value === 'string') {
      const trimmed = value.trim();
      patch[key] = trimmed === '' ? null : trimmed;
    }
  }
  for (const key of ['llmModel', 'embeddingModel'] as const) {
    if (typeof body[key] === 'string' && (body[key] as string).trim() !== '') {
      patch[key] = (body[key] as string).trim();
    }
  }
  if (typeof body.embeddingDim === 'number' && Number.isInteger(body.embeddingDim) && body.embeddingDim > 0) {
    patch.embeddingDim = body.embeddingDim;
  }
  return patch;
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const denied = await guard(request); if (denied) return denied;
  try {
    const { id } = await params;
    const memory = await getMemoryReady();
    if (!memory.llmConfigs.getById(id)) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    const body = await request.json().catch(() => ({})) as Record<string, unknown>;
    const updated = memory.llmConfigs.update(id, buildPatch(body));
    if (!updated) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json({
      ...updated,
      openaiApiKey: maskKey(updated.openaiApiKey),
      embeddingApiKey: updated.embeddingApiKey ? maskKey(updated.embeddingApiKey) : undefined,
    });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const denied = await guard(request); if (denied) return denied;
  try {
    const { id } = await params;
    const memory = await getMemoryReady();
    if (!memory.llmConfigs.getById(id)) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    const deleted = memory.llmConfigs.delete(id);
    return NextResponse.json({ deleted });
  } catch (error) {
    return errorResponse(error);
  }
}
