import { NextRequest, NextResponse } from 'next/server';
import { getMemory, getMemoryReady } from '@/lib/memory';
import { CaptureSource } from '@mindstrate/server';
import { errorResponse } from '@/app/api/error-response';
import { canAccessProject, requireSessionFromRequest } from '@/lib/session';

/** GET /api/knowledge */
export async function GET(request: NextRequest) {
  let session;
  try {
    session = requireSessionFromRequest(request);
  } catch (resp) {
    return resp as Response;
  }
  try {
    const memory = getMemory();
    const params = request.nextUrl.searchParams;

    const project = params.get('project');
    if (project && !canAccessProject(session, project)) {
      return NextResponse.json({ error: 'Not Found' }, { status: 404 });
    }
    const limit = parseInt(params.get('limit') || '50', 10);

    const entries = memory.context.readGraphKnowledge({
      project: project || undefined,
      limit,
    });

    const visible = session.role === 'admin' || session.projects.includes('*')
      ? entries
      : entries.filter((e) => !e.project || session.projects.includes(e.project));
    return NextResponse.json({ entries: visible, total: visible.length });
  } catch (error) {
    return errorResponse(error);
  }
}

/** POST /api/knowledge */
export async function POST(request: NextRequest) {
  let session;
  try {
    session = requireSessionFromRequest(request);
  } catch (resp) {
    return resp as Response;
  }
  try {
    const memory = await getMemoryReady();
    const body = await request.json();

    if (!body.title || !body.solution) {
      return NextResponse.json({ error: 'title and solution are required' }, { status: 400 });
    }
    const project = body.project || body.context?.project || undefined;
    if (project && !canAccessProject(session, project)) {
      return NextResponse.json({ error: 'Not Found' }, { status: 404 });
    }
    const result = await memory.knowledge.add({
      type: body.type || 'how_to',
      title: body.title,
      problem: body.problem || undefined,
      solution: body.solution,
      codeSnippets: body.codeSnippets,
      tags: body.tags || [],
      context: {
        language: body.language || body.context?.language || undefined,
        framework: body.framework || body.context?.framework || undefined,
        project,
        filePaths: body.context?.filePaths,
        dependencies: body.context?.dependencies,
      },
      author: body.author || session.name,
      source: CaptureSource.WEB_UI,
      actionable: body.actionable,
    });

    if (!result.success) {
      return NextResponse.json(result);
    }

    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
