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
    name: 'graph_knowledge_search',
    description:
      'Search ECS-native graph knowledge views derived from high-level context nodes such as rules, patterns, and summaries. ' +
      'Use this when you want evolved substrate context instead of legacy knowledge-unit search.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        query: {
          type: 'string',
          description: 'Search query describing the topic, decision, or issue',
        },
        project: {
          type: 'string',
          description: 'Optional project scope for graph knowledge search',
        },
        topK: {
          type: 'number',
          description: 'Maximum number of graph knowledge views to return (default: 5)',
        },
      },
      required: ['query'],
    },
  },
  {
    name: 'context_ingest_event',
    description:
      'Ingest a low-level ECS context event and materialize it as an episode node. ' +
      'Use this for tool results, test failures, git activity, diagnostics, or explicit external signals.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        type: { type: 'string', description: 'Context event type, such as test_result or git_activity' },
        content: { type: 'string', description: 'Raw event content to record' },
        project: { type: 'string', description: 'Optional project scope' },
        sessionId: { type: 'string', description: 'Optional session identifier' },
        actor: { type: 'string', description: 'Optional actor label' },
        domainType: { type: 'string', description: 'Optional domain type override' },
        substrateType: { type: 'string', description: 'Optional substrate type override' },
        title: { type: 'string', description: 'Optional node title override' },
        tags: { type: 'array', items: { type: 'string' }, description: 'Optional tags' },
      },
      required: ['type', 'content'],
    },
  },
  {
    name: 'context_query_graph',
    description:
      'Query ECS context graph nodes directly. ' +
      'Use this when you need raw graph nodes rather than projected knowledge views.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        query: { type: 'string', description: 'Optional lexical query over title/content/tags' },
        project: { type: 'string', description: 'Optional project scope' },
        substrateType: { type: 'string', description: 'Optional substrate filter' },
        domainType: { type: 'string', description: 'Optional domain filter' },
        status: { type: 'string', description: 'Optional status filter' },
        limit: { type: 'number', description: 'Maximum number of nodes to return (default: 10)' },
      },
    },
  },
  {
    name: 'context_edges',
    description: 'List ECS graph edges and relationships.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        sourceId: { type: 'string', description: 'Optional source node id filter' },
        targetId: { type: 'string', description: 'Optional target node id filter' },
        relationType: { type: 'string', description: 'Optional relation type filter' },
        limit: { type: 'number', description: 'Maximum number of edges to return (default: 20)' },
      },
    },
  },
  {
    name: 'context_conflicts',
    description: 'List active ECS conflict records for a project or the entire graph.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        project: { type: 'string', description: 'Optional project scope' },
        limit: { type: 'number', description: 'Maximum number of conflicts to return (default: 20)' },
      },
    },
  },
  {
    name: 'context_conflict_accept',
    description: 'Accept a reflected conflict-resolution candidate and mark the source conflict resolved.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        conflictId: { type: 'string', description: 'Conflict record id' },
        candidateNodeId: { type: 'string', description: 'Reflection candidate node id' },
        resolution: { type: 'string', description: 'Human-readable resolution note' },
      },
      required: ['conflictId', 'candidateNodeId', 'resolution'],
    },
  },
  {
    name: 'context_conflict_reject',
    description: 'Reject a reflected conflict-resolution candidate without resolving the source conflict.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        conflictId: { type: 'string', description: 'Conflict record id' },
        candidateNodeId: { type: 'string', description: 'Reflection candidate node id' },
        reason: { type: 'string', description: 'Why the candidate was rejected' },
      },
      required: ['conflictId', 'candidateNodeId', 'reason'],
    },
  },
  {
    name: 'metabolism_run',
    description: 'Run the ECS metabolism engine and return the run summary.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        project: { type: 'string', description: 'Optional project scope' },
        stage: {
          type: 'string',
          enum: ['digest', 'assimilate', 'compress', 'prune', 'reflect'],
          description: 'Optional single metabolism stage to run',
        },
        trigger: {
          type: 'string',
          enum: ['manual', 'scheduled', 'event_driven'],
          description: 'Why the metabolism run was triggered',
        },
      },
    },
  },
  {
    name: 'context_obsidian_projection_write',
    description: 'Write verified ECS rules, heuristics, axioms, and skills as editable Obsidian markdown projection files.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        rootDir: { type: 'string', description: 'Target Obsidian vault or folder path' },
        project: { type: 'string', description: 'Optional project scope' },
        limit: { type: 'number', description: 'Maximum files to write' },
      },
      required: ['rootDir'],
    },
  },
  {
    name: 'context_obsidian_projection_import',
    description: 'Import an edited ECS Obsidian projection markdown file as a candidate graph node.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        filePath: { type: 'string', description: 'Markdown projection file path to import' },
      },
      required: ['filePath'],
    },
  },
  {
    name: 'bundle_create',
    description: 'Create a portable ECS context bundle from the current graph.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        name: { type: 'string', description: 'Bundle name' },
        version: { type: 'string', description: 'Bundle version (default: 0.1.0)' },
        description: { type: 'string', description: 'Optional description' },
        project: { type: 'string', description: 'Optional project scope' },
        nodeIds: { type: 'array', items: { type: 'string' }, description: 'Optional explicit node ids' },
        includeRelatedEdges: { type: 'boolean', description: 'Include edges between bundled nodes (default: true)' },
      },
      required: ['name'],
    },
  },
  {
    name: 'bundle_validate',
    description: 'Validate a portable ECS context bundle payload.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        bundle: { type: 'object', description: 'Portable bundle payload' },
      },
      required: ['bundle'],
    },
  },
  {
    name: 'bundle_install',
    description: 'Install a portable ECS context bundle payload or local registry reference into the current graph.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        bundle: { type: 'object', description: 'Portable bundle payload' },
        registry: { type: 'string', description: 'Local registry directory for reference installs' },
        reference: { type: 'string', description: 'Bundle reference, for example name@version' },
      },
    },
  },
  {
    name: 'bundle_publish',
    description: 'Publish or prepare a portable ECS context bundle for distribution.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        bundle: { type: 'object', description: 'Portable bundle payload' },
        registry: { type: 'string', description: 'Optional target registry URL or local registry name' },
        visibility: {
          type: 'string',
          enum: ['public', 'private', 'unlisted'],
          description: 'Distribution visibility',
        },
      },
      required: ['bundle'],
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
    name: 'context_internalize',
    description:
      'Generate AGENTS.md, project snapshot, and system prompt suggestions from stable ECS rules, heuristics, and axioms.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        project: {
          type: 'string',
          description: 'Optional project scope',
        },
        limit: {
          type: 'number',
          description: 'Maximum number of stable nodes to include (default: 10)',
        },
      },
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
