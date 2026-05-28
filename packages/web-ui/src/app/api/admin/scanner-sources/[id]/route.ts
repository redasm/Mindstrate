import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import type { ScanInitMode, UpdateScanSourceInput } from '@mindstrate/protocol';
import { getMemoryReady } from '@/lib/memory';
import { errorResponse } from '@/app/api/error-response';
import { ADMIN_COOKIE_NAME, isAdminSession } from '@/lib/admin-session';

const requireAdmin = async (): Promise<NextResponse | null> => {
  const cookieStore = await cookies();
  const token = cookieStore.get(ADMIN_COOKIE_NAME)?.value;
  if (!isAdminSession(token)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  return null;
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

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const denied = await requireAdmin();
  if (denied) return denied;
  try {
    const { id } = await params;
    const memory = await getMemoryReady();
    if (!memory.scanner.getSource(id)) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    const body = await request.json().catch(() => ({})) as Record<string, unknown>;
    const patch = buildPatch(body);
    const updated = memory.scanner.updateSource(id, patch);
    return NextResponse.json(updated);
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const denied = await requireAdmin();
  if (denied) return denied;
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
