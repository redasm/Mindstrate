import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import type { ScanInitMode } from '@mindstrate/protocol';
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

function optionalString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed === '' ? undefined : trimmed;
}

function optionalNumber(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
  return value;
}

export async function GET() {
  const denied = await requireAdmin();
  if (denied) return denied;
  try {
    const memory = await getMemoryReady();
    return NextResponse.json({ sources: memory.scanner.listSources() });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  const denied = await requireAdmin();
  if (denied) return denied;
  try {
    const body = await request.json().catch(() => ({}));
    const kind = body.kind;
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    const project = typeof body.project === 'string' ? body.project.trim() : '';
    if (!name || !project) {
      return NextResponse.json({ error: 'name and project are required' }, { status: 400 });
    }
    const initMode = typeof body.initMode === 'string' && VALID_INIT_MODES.includes(body.initMode as ScanInitMode)
      ? (body.initMode as ScanInitMode)
      : 'from_now';
    const intervalSec = optionalNumber(body.intervalSec) ?? 300;
    const backfillCount = optionalNumber(body.backfillCount) ?? 10;

    const memory = await getMemoryReady();

    if (kind === 'git-local') {
      const repoPath = optionalString(body.repoPath);
      const remoteUrl = optionalString(body.remoteUrl);
      if (!repoPath && !remoteUrl) {
        return NextResponse.json({ error: 'git-local requires repoPath or remoteUrl' }, { status: 400 });
      }
      const created = memory.scanner.createGitLocalSource({
        name,
        project,
        repoPath: repoPath ?? `/repos/auto`,
        branch: optionalString(body.branch),
        remoteUrl,
        authToken: optionalString(body.authToken),
        intervalSec,
        initMode,
        backfillCount,
      });
      return NextResponse.json(created, { status: 201 });
    }

    if (kind === 'p4') {
      const depotPath = optionalString(body.depotPath);
      if (!depotPath) {
        return NextResponse.json({ error: 'p4 requires depotPath' }, { status: 400 });
      }
      const created = memory.scanner.createP4Source({
        name,
        project,
        depotPath,
        p4Port: optionalString(body.p4Port),
        p4User: optionalString(body.p4User),
        p4Passwd: typeof body.p4Passwd === 'string' && body.p4Passwd !== '' ? body.p4Passwd : undefined,
        intervalSec,
        initMode,
        backfillCount,
      });
      return NextResponse.json(created, { status: 201 });
    }

    return NextResponse.json({ error: 'kind must be "git-local" or "p4"' }, { status: 400 });
  } catch (error) {
    return errorResponse(error);
  }
}
