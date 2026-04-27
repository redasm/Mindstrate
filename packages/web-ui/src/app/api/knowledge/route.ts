import { NextRequest, NextResponse } from 'next/server';
import { getMemory, getMemoryReady } from '@/lib/memory';
import { CaptureSource } from '@mindstrate/server';
import { errorResponse } from '@/app/api/error-response';

/** GET /api/knowledge - 列出知识 */
export async function GET(request: NextRequest) {
  try {
    const memory = getMemory();
    const params = request.nextUrl.searchParams;

    const project = params.get('project');
    const limit = parseInt(params.get('limit') || '50', 10);

    const entries = memory.readGraphKnowledge({
      project: project || undefined,
      limit,
    });

    return NextResponse.json({ entries, total: entries.length });
  } catch (error) {
    return errorResponse(error);
  }
}

/** POST /api/knowledge - 添加知识 */
export async function POST(request: NextRequest) {
  try {
    const memory = await getMemoryReady();
    const body = await request.json();

    if (!body.title || !body.solution) {
      return NextResponse.json({ error: 'title and solution are required' }, { status: 400 });
    }
    const result = await memory.add({
      type: body.type || 'how_to',
      title: body.title,
      problem: body.problem || undefined,
      solution: body.solution,
      codeSnippets: body.codeSnippets,
      tags: body.tags || [],
      context: {
        language: body.language || body.context?.language || undefined,
        framework: body.framework || body.context?.framework || undefined,
        project: body.project || body.context?.project || undefined,
        filePaths: body.context?.filePaths,
        dependencies: body.context?.dependencies,
      },
      author: body.author || 'web-ui',
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
