# Context Engineering

Mindstrate treats context engineering as the workflow that turns stored memory, project graph facts, sessions, and feedback into a bounded working context for an AI agent.

## Goal

The goal is not to inject every related fact into the prompt. The goal is to assemble the smallest useful context package for the current task, with enough evidence and warnings for the agent to choose the right files and avoid known risks.

## Inputs

Context assembly may use:

- restored session summaries and open tasks,
- project snapshots,
- project graph nodes, edges, and reports,
- graph knowledge search results,
- workflows, conventions, and active rules,
- conflicts and warnings,
- recent events and feedback signals.

## Assembly Policy

The assembler should prefer mature, high-confidence graph nodes over raw episodes when both describe the same fact. It should expose conflicts explicitly, include evidence paths where available, and respect token or character budgets.

Recommended priority:

```text
active conflicts and warnings
  -> project snapshot and graph entry points
  -> applicable rules and patterns
  -> task-specific knowledge and workflows
  -> session continuity and open tasks
  -> raw episodes only when needed
```

## Time Awareness

Context relevance is time-sensitive. Recent project events, active sessions, and newly changed files may deserve higher priority. Old knowledge should be down-ranked when it is stale, contradicted, deprecated, or tied to obsolete framework versions.

## Human-Readable Output

Context output should be directly usable by an agent and inspectable by a human. It should explain why each section is included, cite evidence when possible, and suggest follow-up project graph queries instead of expanding unlimited context.

## Feedback Loop

Agent adoption, rejection, ignored results, manual votes, and task outcomes should feed back into quality and priority scoring. Context assembly is therefore not a static formatter; it is part of the memory governance loop.

## Non-Goals

Context engineering does not make Markdown the only source of truth, does not replace project graph queries, and does not bypass provenance. It coordinates existing memory surfaces into a reliable working context.
