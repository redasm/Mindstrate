import { NextRequest, NextResponse } from 'next/server';
import { getMemoryReady } from '@/lib/memory';
import { errorResponse } from '@/app/api/error-response';
import { requireAdminFromRequest } from '@/lib/session';

const guard = (req: NextRequest): Response | null => {
  try {
    requireAdminFromRequest(req);
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

const optionalString = (value: unknown): string | undefined => {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed === '' ? undefined : trimmed;
};

export async function GET(req: NextRequest) {
  const denied = guard(req); if (denied) return denied;
  try {
    const memory = await getMemoryReady();
    const configs = memory.llmConfigs.list().map((config) => ({
      ...config,
      openaiApiKey: maskKey(config.openaiApiKey),
    }));
    return NextResponse.json({ configs });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  const denied = guard(request); if (denied) return denied;
  try {
    const body = await request.json().catch(() => ({}));
    const project = optionalString(body.project);
    const openaiApiKey = typeof body.openaiApiKey === 'string' ? body.openaiApiKey : '';
    const llmModel = optionalString(body.llmModel);
    const embeddingModel = optionalString(body.embeddingModel);
    const embeddingDim = typeof body.embeddingDim === 'number' && Number.isInteger(body.embeddingDim) && body.embeddingDim > 0
      ? body.embeddingDim
      : undefined;

    if (!project) return NextResponse.json({ error: 'project is required' }, { status: 400 });
    if (!openaiApiKey) return NextResponse.json({ error: 'openaiApiKey is required' }, { status: 400 });
    if (!llmModel) return NextResponse.json({ error: 'llmModel is required' }, { status: 400 });
    if (!embeddingModel) return NextResponse.json({ error: 'embeddingModel is required' }, { status: 400 });
    if (!embeddingDim) return NextResponse.json({ error: 'embeddingDim must be a positive integer' }, { status: 400 });

    const memory = await getMemoryReady();
    const existing = memory.llmConfigs.getByProject(project);
    if (existing) {
      return NextResponse.json({ error: `A config for project "${project}" already exists` }, { status: 409 });
    }

    const created = memory.llmConfigs.create({
      project,
      openaiApiKey,
      llmBaseUrl: optionalString(body.llmBaseUrl),
      embeddingBaseUrl: optionalString(body.embeddingBaseUrl),
      llmModel,
      embeddingModel,
      embeddingDim,
    });

    return NextResponse.json({ ...created, openaiApiKey: maskKey(created.openaiApiKey) }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
