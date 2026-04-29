# Mindstrate Documentation

The root README is intentionally short. Detailed manuals live in this directory.

## User Guides

- [Installation Guide](installation.en.md): local setup, Team Server deployment, team member setup, MCP config, LLM providers.
- [Data Collection Guide](data-collection.en.md): repo-scanner, Git/P4, hooks, daemon, custom collectors, standard changesets.
- [Project Configuration](project-configuration.en.md): `.mindstrate/project.json`, `.mindstrate/config.json`, built-in and custom project rules.
- [Project Detection Rules](project-detection-rules.en.md): rule schema and security boundary.
- [Deployment Guide](deployment-guide.md): deeper deployment and operations guide.

## Architecture And Design

- [Architecture](architecture.md): package boundaries and import rules.
- [Repo Scanner Design](repo-scanner-design.md): why source collection lives outside the framework.
- [Project Graph Init Plan](project-graph-init-plan.md): project graph implementation roadmap.
- [ECS Refactor Design](ecs-refactor-design.md): ECS memory architecture design.
- [Context Engineering Optimization Plan](context-engineering-optimization-plan.md): context assembly and optimization planning.
