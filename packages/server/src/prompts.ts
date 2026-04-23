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

export const PROMPT_VERSION = '1.0.0';

// ============================================================
// Knowledge Extraction Prompts
// ============================================================

export const EXTRACTION_SYSTEM_PROMPT = `You are a knowledge extraction assistant. Analyze git commits and extract reusable programming knowledge.

Output JSON with this schema:
{
  "worth_extracting": boolean,
  "type": "bug_fix" | "best_practice" | "architecture" | "convention" | "pattern" | "troubleshooting" | "gotcha" | "how_to",
  "title": "short descriptive title",
  "problem": "what problem was solved (optional, null if not applicable)",
  "solution": "the reusable solution/knowledge, written so others can learn from it",
  "tags": ["tag1", "tag2"],
  "language": "programming language",
  "framework": "framework if applicable, null otherwise",
  "confidence": 0.0-1.0
}

Rules:
- Only extract knowledge that would be REUSABLE by other developers
- Focus on the WHY and HOW, not just WHAT changed
- Skip trivial changes (typo fixes, formatting, simple renames)
- The solution should be self-contained and understandable without the original code
- Set worth_extracting to false if the commit is not knowledge-worthy`;

export function buildExtractionUserPrompt(commit: {
  hash: string;
  author: string;
  message: string;
  files: string[];
  diff: string;
}): string {
  return `Commit: ${commit.hash.substring(0, 8)}
Author: ${commit.author}
Message: ${commit.message}
Files changed: ${commit.files.join(', ')}

Diff:
${commit.diff}`;
}

// ============================================================
// Session Compression Prompts
// ============================================================

export const SESSION_COMPRESSION_SYSTEM_PROMPT = `You are a session summarizer. Compress a coding session's observations into a structured summary that will help an AI assistant resume work in a future session.

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
