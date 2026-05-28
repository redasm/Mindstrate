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

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const denied = guard(req); if (denied) return denied;
  try {
    const { id } = await params;
    const memory = await getMemoryReady();
    const key = memory.apiKeys.getById(id);
    if (!key) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json({ key });
  } catch (e) { return errorResponse(e); }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const denied = guard(req); if (denied) return denied;
  try {
    const { id } = await params;
    const memory = await getMemoryReady();
    const existing = memory.apiKeys.getById(id);
    if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    const body = await req.json().catch(() => ({}));
    const out: Record<string, unknown> = {};

    if (body.role === 'admin') {
      return NextResponse.json(
        { error: 'Admins cannot be created or promoted via the web UI. Bootstrap via TEAM_API_KEY.' },
        { status: 400 },
      );
    }
    if (body.role === 'member') {
      if (existing.role === 'admin' && memory.apiKeys.countAdmins() <= 1) {
        return NextResponse.json(
          { error: 'Cannot demote the last remaining admin' }, { status: 400 },
        );
      }
      memory.apiKeys.setRole(id, 'member');
      out.role = 'member';
    }
    if (Array.isArray(body.projects)) {
      const projects = body.projects
        .filter((p: unknown): p is string => typeof p === 'string' && p.trim() !== '')
        .map((p: string) => p.trim());
      memory.apiKeys.setProjects(id, projects);
      out.projects = projects;
    }
    if (typeof body.enabled === 'boolean') {
      if (existing.role === 'admin' && !body.enabled && memory.apiKeys.countAdmins() <= 1) {
        return NextResponse.json(
          { error: 'Cannot disable the last remaining admin' }, { status: 400 },
        );
      }
      memory.apiKeys.setEnabled(id, body.enabled);
      out.enabled = body.enabled;
    }
    if (body.regenerate === true) {
      const result = memory.apiKeys.regenerateKey(id);
      if (result) out.newKey = result.newKey;
    }
    return NextResponse.json({ ok: true, ...out });
  } catch (e) { return errorResponse(e); }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const denied = guard(req); if (denied) return denied;
  try {
    const { id } = await params;
    const memory = await getMemoryReady();
    const existing = memory.apiKeys.getById(id);
    if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    if (existing.role === 'admin' && memory.apiKeys.countAdmins() <= 1) {
      return NextResponse.json(
        { error: 'Cannot delete the last remaining admin' }, { status: 400 },
      );
    }
    memory.apiKeys.deleteHard(id);
    return NextResponse.json({ ok: true });
  } catch (e) { return errorResponse(e); }
}
