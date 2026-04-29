import type { McpApi, McpToolResponse, SessionState } from '../types.js';

type ToolInput = any;

export async function handleSessionStart(
  api: McpApi,
  args: Record<string, unknown> | undefined,
  session: SessionState,
): Promise<McpToolResponse> {
  const project = (args?.project as string) ?? '';
  const { session: sess, context } = await api.startSession(
    project,
    args?.techContext as string | undefined,
  );

  session.currentSessionId = sess.id;
  session.currentSessionProject = project;

  let response = `Session started: ${sess.id}\nProject: ${project || '(default)'}`;
  if (context) {
    response += `\n\n${context}`;
  } else {
    response += '\n\nNo previous session context found. This is a fresh start.';
  }

  return { content: [{ type: 'text', text: response }] };
}

export async function handleSessionSave(
  api: McpApi,
  input: ToolInput,
  session: SessionState,
): Promise<McpToolResponse> {
  let sessionId = session.currentSessionId;
  if (!sessionId) {
    const activeSession = await api.getActiveSession(session.currentSessionProject);
    sessionId = activeSession?.id ?? null;
  }

  if (!sessionId) {
    return {
      content: [{ type: 'text', text: 'No active session. Call session_start first.' }],
      isError: true,
    };
  }

  await api.saveObservation(sessionId, input.type, input.content, input.metadata);

  return {
    content: [{ type: 'text', text: `Observation saved: [${input.type}] ${input.content.substring(0, 80)}` }],
  };
}

export async function handleSessionEnd(
  api: McpApi,
  args: Record<string, unknown> | undefined,
  session: SessionState,
): Promise<McpToolResponse> {
  let sessionId = session.currentSessionId;
  if (!sessionId) {
    const active = await api.getActiveSession(session.currentSessionProject);
    sessionId = active?.id ?? null;
  }

  if (!sessionId) {
    return {
      content: [{ type: 'text', text: 'No active session to end.' }],
    };
  }

  await api.endSession(
    sessionId,
    args?.summary as string | undefined,
    args?.openTasks as string[] | undefined,
  );

  const sess = await api.getSession(sessionId);
  session.currentSessionId = null;

  return {
    content: [{
      type: 'text',
      text: `Session ended: ${sessionId}\nSummary: ${sess?.summary ?? 'auto-generated'}`,
    }],
  };
}

export async function handleSessionRestore(
  api: McpApi,
  args: Record<string, unknown> | undefined,
): Promise<McpToolResponse> {
  const project = (args?.project as string) ?? '';
  const context = await api.formatSessionContext(project);

  if (!context) {
    return {
      content: [{ type: 'text', text: 'No previous session context found for this project.' }],
    };
  }

  return { content: [{ type: 'text', text: context }] };
}
