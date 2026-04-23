/**
 * MCP Tool Definitions
 *
 * JSON Schema definitions for all MCP tools exposed by Mindstrate.
 */

import { KnowledgeType } from '@mindstrate/protocol';

export const TOOL_DEFINITIONS = [
  {
    name: 'memory_search',
    description:
      'Search the team knowledge base for relevant solutions, best practices, and coding patterns. ' +
      'Use this when solving bugs, implementing features, or looking for team conventions.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        query: {
          type: 'string',
          description: 'Search query describing the problem or topic',
        },
        language: {
          type: 'string',
          description: 'Programming language filter (e.g., typescript, python)',
        },
        framework: {
          type: 'string',
          description: 'Framework filter (e.g., react, nextjs)',
        },
        type: {
          type: 'string',
          description: 'Knowledge type filter',
          enum: Object.values(KnowledgeType),
        },
        topK: {
          type: 'number',
          description: 'Number of results (default: 5)',
        },
      },
      required: ['query'],
    },
  },
  {
    name: 'memory_add',
    description:
      'Add a new knowledge entry to the team knowledge base. ' +
      'Use this when a valuable solution, pattern, or convention is discovered during coding.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        title: {
          type: 'string',
          description: 'Short descriptive title',
        },
        type: {
          type: 'string',
          description: 'Knowledge type',
          enum: Object.values(KnowledgeType),
        },
        problem: {
          type: 'string',
          description: 'Problem description',
        },
        solution: {
          type: 'string',
          description: 'Solution or knowledge content',
        },
        tags: {
          type: 'array',
          items: { type: 'string' },
          description: 'Relevant tags',
        },
        language: {
          type: 'string',
          description: 'Programming language',
        },
        framework: {
          type: 'string',
          description: 'Framework name',
        },
        actionable: {
          type: 'object',
          description: 'Actionable guidance (steps, preconditions, verification)',
          properties: {
            preconditions: { type: 'array', items: { type: 'string' }, description: 'When to use this knowledge' },
            steps: { type: 'array', items: { type: 'string' }, description: 'Step-by-step procedure' },
            verification: { type: 'string', description: 'How to verify the solution worked' },
            antiPatterns: { type: 'array', items: { type: 'string' }, description: 'Common mistakes to avoid' },
          },
        },
      },
      required: ['title', 'type', 'solution'],
    },
  },
  {
    name: 'memory_feedback',
    description: 'Provide feedback on a knowledge entry (upvote or downvote).',
    inputSchema: {
      type: 'object' as const,
      properties: {
        id: {
          type: 'string',
          description: 'Knowledge entry ID',
        },
        vote: {
          type: 'string',
          enum: ['up', 'down'],
          description: 'Vote direction',
        },
      },
      required: ['id', 'vote'],
    },
  },
  {
    name: 'session_start',
    description:
      'Start a new coding session. Call this at the beginning of a conversation to register this session ' +
      'and automatically receive context from previous sessions.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        project: {
          type: 'string',
          description: 'Project identifier (e.g., directory name)',
        },
        techContext: {
          type: 'string',
          description: 'Current tech stack context (e.g., "Next.js 15, TypeScript, PostgreSQL")',
        },
      },
    },
  },
  {
    name: 'session_save',
    description:
      'Save an important observation during the current session. Call this when you make a key decision, ' +
      'solve a problem, encounter a blocker, or complete a significant task. This builds the session memory.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        type: {
          type: 'string',
          enum: [
            'task_start', 'decision', 'problem_solved', 'file_change',
            'insight', 'blocker', 'progress',
            'decision_path', 'failed_path', 'knowledge_applied', 'knowledge_rejected',
          ],
          description: 'Type of observation',
        },
        content: {
          type: 'string',
          description: 'Description of what happened',
        },
      },
      required: ['type', 'content'],
    },
  },
  {
    name: 'session_end',
    description:
      'End the current session. This compresses all observations into a summary that will be ' +
      'available in future sessions. Call this when the user is done or switching context.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        summary: {
          type: 'string',
          description: 'Optional manual summary. If omitted, an automatic summary is generated.',
        },
        openTasks: {
          type: 'array',
          items: { type: 'string' },
          description: 'Tasks that are not yet finished and should be continued next session',
        },
      },
    },
  },
  {
    name: 'session_restore',
    description:
      'Restore context from previous sessions. Returns a summary of what was done before, ' +
      'open tasks, key decisions, and recent session timeline. Call this at the start of a new session.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        project: {
          type: 'string',
          description: 'Project identifier to restore context for',
        },
      },
    },
  },
  {
    name: 'memory_feedback_auto',
    description:
      'Record automatic feedback on a previously retrieved knowledge entry. ' +
      'Call this when you use, reject, or ignore a knowledge entry from search results. ' +
      'This helps the system learn which knowledge is actually useful.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        retrievalId: {
          type: 'string',
          description: 'The retrievalId returned from memory_search results',
        },
        signal: {
          type: 'string',
          enum: ['adopted', 'rejected', 'ignored', 'partial'],
          description: 'How the knowledge was used: adopted (used fully), rejected (not applicable), ignored (not used), partial (partially used)',
        },
        context: {
          type: 'string',
          description: 'Optional reason for the feedback signal',
        },
      },
      required: ['retrievalId', 'signal'],
    },
  },
  {
    name: 'memory_curate',
    description:
      'Get a curated knowledge package for a specific task. ' +
      'Returns relevant solutions, workflows/steps to follow, and warnings/pitfalls to avoid. ' +
      'Use this before starting a complex task to get all relevant context at once.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        task: {
          type: 'string',
          description: 'Description of the task you are about to work on',
        },
        language: {
          type: 'string',
          description: 'Programming language context',
        },
        framework: {
          type: 'string',
          description: 'Framework context',
        },
      },
      required: ['task'],
    },
  },
  {
    name: 'context_assemble',
    description:
      'Assemble a full working context for a task by combining session continuity, project snapshot, ' +
      'and curated task-specific knowledge. Use this before starting non-trivial work.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        task: {
          type: 'string',
          description: 'Description of the task you are about to work on',
        },
        project: {
          type: 'string',
          description: 'Project identifier used for session continuity and project snapshot lookup',
        },
        language: {
          type: 'string',
          description: 'Programming language context',
        },
        framework: {
          type: 'string',
          description: 'Framework context',
        },
      },
      required: ['task'],
    },
  },
  {
    name: 'memory_evolve',
    description:
      'Run the knowledge evolution engine to identify improvements, merges, and deprecations. ' +
      'This analyzes the knowledge base using feedback data to suggest improvements. ' +
      'Call this periodically during maintenance.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        autoApply: {
          type: 'boolean',
          description: 'Automatically apply low-risk improvements (default: false)',
        },
        maxItems: {
          type: 'number',
          description: 'Maximum number of knowledge entries to analyze (default: 100)',
        },
        mode: {
          type: 'string',
          enum: ['standard', 'background'],
          description: 'background = lightweight scan/report only; standard = full evolution flow',
        },
      },
    },
  },
];
