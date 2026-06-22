/**
 * Mindstrate - LLM Prompt Templates
 *
 * All LLM prompts are externalized here for:
 * 1. Easy iteration and versioning
 * 2. Potential A/B testing
 * 3. Separation of concerns (prompts are not business logic)
 *
 * Each prompt has a version for tracking which prompts produced which knowledge.
 */

export const PROMPT_VERSION = '2.1.0';

// ============================================================
// Knowledge Extraction Prompts
// ============================================================

const EXTRACTION_SYSTEM_PROMPT_BASE = `You are a senior engineer writing durable, reusable engineering knowledge from a git/Perforce commit. Your output becomes a permanent knowledge card other developers (and AI agents) will read months later WITHOUT access to this commit or diff. Shallow one-liners are useless — be thorough, concrete, and self-contained.

Output a single JSON object with this schema:
{
  "worth_extracting": boolean,
  "type": "bug_fix" | "best_practice" | "architecture" | "convention" | "pattern" | "troubleshooting" | "gotcha" | "how_to",
  "title": "specific, searchable title (NOT the raw commit message)",
  "problem": "the problem / motivation / symptom this change addresses, with enough context to understand WHY it mattered (null only if genuinely not applicable)",
  "solution": "the reusable knowledge as rich Markdown. This is the main body of the card and MUST be substantial. Use these sections where applicable:\\n## 背景 / Why\\n## 做法 / Approach\\n## 关键实现 / Key implementation (reference concrete functions, classes, files)\\n## 影响范围 / Impact\\n## 注意事项 / Gotchas\\nExplain mechanisms, trade-offs, and the reasoning — not just what files changed.",
  "key_points": ["3-7 concise, standalone takeaways a reader should remember"],
  "code_snippets": [{ "language": "ts", "description": "what this snippet shows and why it matters", "code": "the actual representative code", "file_path": "path/to/file" }],
  "actionable": {
    "preconditions": ["when this knowledge applies"],
    "steps": ["concrete reproducible steps to apply the same solution/pattern"],
    "verification": "how to confirm it worked",
    "anti_patterns": ["common wrong approaches / red flags to avoid"]
  },
  "tags": ["specific", "searchable", "tags"],
  "language": "primary programming language",
  "framework": "framework if applicable, null otherwise",
  "confidence": 0.0-1.0
}

Rules:
- Only extract knowledge that is genuinely REUSABLE. Set worth_extracting=false for trivial commits (typo/format/version bump/merge) and return minimal other fields.
- Be CONCRETE: cite real identifiers (class/function/file names) seen in the diff so the card is actionable without the original code.
- Extract code_snippets DIRECTLY from the diff — pick the most representative added lines; do not invent code. Empty array if no meaningful snippet.
- Prefer depth over breadth: a long, well-structured solution is the goal. Do not pad with generic filler.`;

/**
 * Build the knowledge-extraction system prompt for the configured content
 * locale. The language instruction is appended last so it overrides any
 * language cue the model might otherwise take from the commit message/diff —
 * the whole knowledge base must be in the operator's configured language, not
 * whatever language each commit happened to be written in.
 */
export function buildExtractionSystemPrompt(languageInstruction: string): string {
  return `${EXTRACTION_SYSTEM_PROMPT_BASE}\n- ${languageInstruction}`;
}

export function buildExtractionUserPrompt(commit: {
  hash: string;
  author: string;
  message: string;
  files: string[];
  diff: string;
}): string {
  return `Analyze this commit and extract reusable knowledge per the schema.

Commit: ${commit.hash.substring(0, 8)}
Author: ${commit.author}
Message: ${commit.message}
Files changed: ${commit.files.join(', ')}

Diff:
${commit.diff}`;
}

// ============================================================
// Session Compression Prompts
// ============================================================

const SESSION_COMPRESSION_SYSTEM_PROMPT_BASE = `You are a session summarizer. Compress a coding session's observations into a structured summary that will help an AI assistant resume work in a future session.

Output JSON:
{
  "summary": "2-4 sentence summary of what was accomplished and the current state",
  "decisions": ["key technical decisions made during this session"],
  "openTasks": ["tasks that were started but not completed, or next steps identified"],
  "problemsSolved": ["problems that were solved, with brief solution descriptions"],
  "filesModified": ["important files that were created or modified"]
}

Rules:
- Be concise but preserve critical context
- Focus on WHAT was done and WHY, not trivial details
- OpenTasks should be actionable — things the next session should continue
- Include enough detail that someone can resume without re-reading all the code`;

/**
 * Build the session-compression system prompt for the configured content
 * locale. The summary becomes a knowledge node, so it must honor the
 * operator's configured language rather than the language of the raw
 * observations.
 */
export function buildSessionCompressionSystemPrompt(languageInstruction: string): string {
  return `${SESSION_COMPRESSION_SYSTEM_PROMPT_BASE}\n- ${languageInstruction}`;
}

export function buildSessionCompressionUserPrompt(session: {
  project: string;
  techContext?: string;
  startedAt: string;
  observationsText: string;
  observationCount: number;
}): string {
  return `Project: ${session.project || 'unknown'}
Tech Context: ${session.techContext || 'not specified'}
Session Duration: ${session.startedAt} to now
Observations (${session.observationCount}):
${session.observationsText}`;
}

// ============================================================
// Knowledge Evolution Prompts
// ============================================================

export const EVOLUTION_IMPROVE_SYSTEM_PROMPT = `You are a knowledge quality optimizer. Given a knowledge entry that has low adoption rate, improve its title, problem description, and solution to be more clear, actionable, and useful. Keep the core meaning unchanged (semantic preservation). Return JSON with fields: title, problem, solution, tags (array of strings).`;

export function buildEvolutionImproveUserPrompt(knowledge: {
  currentTitle: string;
  currentProblem?: string;
  currentSolution: string;
  currentTags: string[];
  type: string;
  language?: string;
  framework?: string;
  feedbackIssue: string;
}): string {
  return JSON.stringify(knowledge);
}
