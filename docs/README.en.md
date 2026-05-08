# Mindstrate Documentation

The root README is intentionally short. Detailed manuals live in this directory.

## User Guides

- [Installation Guide](installation.en.md): local setup, Team Server deployment, team member setup, MCP config, LLM providers.
- [Data Collection Guide](data-collection.en.md): repo-scanner, Git/P4, hooks, daemon, custom collectors, standard changesets.
- [Project Configuration](project-configuration.en.md): `.mindstrate/project.json`, `.mindstrate/config.json`, built-in and custom project rules.
- [Project Detection Rules](project-detection-rules.en.md): rule schema and security boundary.
- [Deployment Guide](deployment-guide.en.md): deployment modes and operations guide.

## Architecture And Design

- [Architecture](architecture.en.md): package boundaries and import rules.
- [Repo Scanner](repo-scanner.en.md): external repository collection boundary and workflows.
- [Project Graph](project-graph.en.md): parser-first project graph pipeline and query surface.
- [ECS Memory Architecture](ecs-memory.en.md): graph-first memory substrate and metabolism model.
- [Context Engineering](context-engineering.en.md): working-context assembly policy.
