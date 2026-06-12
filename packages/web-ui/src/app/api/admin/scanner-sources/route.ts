import { NextRequest, NextResponse } from 'next/server';
import type { ScanInitMode } from '@mindstrate/protocol';
import { getMemoryReady } from '@/lib/memory';
import { errorResponse } from '@/app/api/error-response';
import { requireAdminFromRequest } from '@/lib/session';
import { buildScannerSourceView, listScannerSourceViews } from '@/lib/scanner-source-view';
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

function optionalString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed === '' ? undefined : trimmed;
}

function optionalNumber(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
  return value;
}

export async function GET(req: NextRequest) {
  const denied = await guard(req); if (denied) return denied;
  try {
    const memory = await getMemoryReady();
    return NextResponse.json({ sources: listScannerSourceViews(memory) });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  const denied = await guard(request); if (denied) return denied;
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
      const authToken = optionalString(body.authToken);
      try {
        validateGitSource({ repoPath, remoteUrl, authToken });
      } catch (error) {
        return NextResponse.json({ error: errorMessage(error) }, { status: 400 });
      }
      const created = memory.scanner.createGitLocalSource({
        name,
        project,
        repoPath,
        branch: optionalString(body.branch),
        remoteUrl,
        authToken,
        intervalSec,
        initMode,
        backfillCount,
      });
      return NextResponse.json(buildScannerSourceView(memory, created), { status: 201 });
    }

    if (kind === 'p4') {
      const depotPath = optionalString(body.depotPath);
      if (!depotPath) {
        return NextResponse.json({ error: 'p4 requires depotPath' }, { status: 400 });
      }
      const repoPath = optionalString(body.repoPath);
      const p4Port = optionalString(body.p4Port);
      const p4User = optionalString(body.p4User);
      const p4Passwd = typeof body.p4Passwd === 'string' && body.p4Passwd !== '' ? body.p4Passwd : undefined;
      try {
        validateP4Source({ repoPath, depotPath, p4Port, p4User, p4Passwd });
      } catch (error) {
        return NextResponse.json({ error: errorMessage(error) }, { status: 400 });
      }
      const created = memory.scanner.createP4Source({
        name,
        project,
        repoPath,
        depotPath,
        p4Port,
        p4User,
        p4Passwd,
        intervalSec,
        initMode,
        backfillCount,
      });
      return NextResponse.json(buildScannerSourceView(memory, created), { status: 201 });
    }

    return NextResponse.json({ error: 'kind must be "git-local" or "p4"' }, { status: 400 });
  } catch (error) {
    return errorResponse(error);
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
