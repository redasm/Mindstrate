# Mindstrate 文档

根目录 README 只保留项目入口和常用命令；详细手册放在本目录。

## 用户指南

- [安装指南](installation.md)：个人本地安装、Team Server 部署、团队成员接入、MCP 配置、LLM 服务商。
- [数据采集指南](data-collection.md)：repo-scanner、Git/P4、hook、daemon、自定义 collector、标准 changeset。
- [项目配置](project-configuration.md)：`.mindstrate/project.json`、`.mindstrate/config.json`、内置和自定义项目规则。
- [项目检测规则](project-detection-rules.md)：规则 schema 和安全边界。
- [部署指南](deployment-guide.md)：更完整的部署和运维说明。

## 架构与设计

- [Architecture](architecture.md)：包边界和 import 规则。
- [Repo Scanner Design](repo-scanner-design.md)：为什么 source collection 在框架外。
- [Project Graph Init Plan](project-graph-init-plan.md)：项目图谱实施路线。
- [ECS Refactor Design](ecs-refactor-design.md)：ECS 记忆架构设计。
- [Context Engineering Optimization Plan](context-engineering-optimization-plan.md)：上下文装配与优化计划。
