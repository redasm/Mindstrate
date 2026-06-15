import { NextRequest, NextResponse } from 'next/server';
import type { ScanInitMode, ScanSource, UpdateScanSourceInput } from '@mindstrate/protocol';
import { getMemoryReady } from '@/lib/memory';
import { errorResponse } from '@/app/api/error-response';
import { requireAdminFromRequest } from '@/lib/session';
import { buildScannerSourceView } from '@/lib/scanner-source-view';
import { validateGitSource, validateP4Source } from '@/lib/scanner-source-validation';

const guard = async (req: NextRequest): Promise<Response | null> => {
  try {
    await requireAdminFromRequest(req);
    return null;
  } catch (resp) {
    return resp as Response;
  }
};

const VALID_INIT_MODES: ScanInitMode[] = ['from_now', 'backfill_recent'];

function pickString(body: Record<string, unknown>, key: string): string | undefined | null {
  if (!(key in body)) return undefined;
  const value = body[key];
  if (value === null) return null;
  if (typeof value !== 'string') return undefined;
  return value;
}

function pickNumber(body: Record<string, unknown>, key: string): number | undefined {
  if (!(key in body)) return undefined;
  const value = body[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function buildPatch(body: Record<string, unknown>): UpdateScanSourceInput {
  const patch: UpdateScanSourceInput = {};
  const name = pickString(body, 'name');
  if (typeof name === 'string') patch.name = name.trim();
  const project = pickString(body, 'project');
  if (typeof project === 'string') patch.project = project.trim();
  if (typeof body.enabled === 'boolean') patch.enabled = body.enabled;

  for (const key of ['repoPath', 'depotPath', 'branch'] as const) {
    const value = pickString(body, key);
    if (typeof value === 'string') patch[key] = value;
  }
  for (const key of ['remoteUrl', 'authToken', 'p4Port', 'p4User', 'p4Passwd'] as const) {
    const value = pickString(body, key);
    if (value === undefined) continue;
    patch[key] = value === null ? null : value;
  }

  const intervalSec = pickNumber(body, 'intervalSec');
  if (intervalSec !== undefined) patch.intervalSec = intervalSec;
  const backfillCount = pickNumber(body, 'backfillCount');
  if (backfillCount !== undefined) patch.backfillCount = backfillCount;

  if (typeof body.initMode === 'string' && VALID_INIT_MODES.includes(body.initMode as ScanInitMode)) {
    patch.initMode = body.initMode as ScanInitMode;
  }
  return patch;
}

function validateSource(source: ScanSource): { error: string | null; warnings: string[] } {
  try {
    if (source.kind === 'git-local') {
      const warnings = validateGitSource({ repoPath: source.repoPath, remoteUrl: source.remoteUrl, authToken: source.authToken });
      return { error: null, warnings };
    }
    if (!source.depotPath) return { error: 'p4 requires depotPath', warnings: [] };
    const warnings = validateP4Source({
      repoPath: source.repoPath,
      depotPath: source.depotPath,
      p4Port: source.p4Port,
      p4User: source.p4User,
      p4Passwd: source.p4Passwd,
    });
    return { error: null, warnings };
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error), warnings: [] };
  }
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const denied = await guard(request); if (denied) return denied;
  try {
    const { id } = await params;
    const memory = await getMemoryReady();
    const current = memory.scanner.getSource(id);
    if (!current) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    const body = await request.json().catch(() => ({})) as Record<string, unknown>;
    const patch = buildPatch(body);
    const validation = validateSource({ ...current, ...patch } as ScanSource);
    if (validation.error) {
      return NextResponse.json({ error: validation.error }, { status: 400 });
    }
    const updated = memory.scanner.updateSource(id, patch);
    return NextResponse.json(
      updated ? { ...buildScannerSourceView(memory, updated), warnings: validation.warnings } : updated,
    );
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const denied = await guard(request); if (denied) return denied;
  try {
    const { id } = await params;
    const memory = await getMemoryReady();
    if (!memory.scanner.getSource(id)) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    const deleted = memory.scanner.deleteSource(id);
    return NextResponse.json({ deleted });
  } catch (error) {
    return errorResponse(error);
  }
}
