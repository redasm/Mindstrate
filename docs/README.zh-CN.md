# Mindstrate 文档

根目录 README 只保留项目入口和常用命令；详细手册放在本目录。

## 用户指南

- [安装指南](installation.zh-CN.md)：个人本地安装、Team Server 部署、团队成员接入、MCP 配置、LLM 服务商。
- [数据采集指南](data-collection.zh-CN.md)：repo-scanner、Git/P4、hook、daemon、自定义 collector、标准 changeset。
- [项目配置](project-configuration.zh-CN.md)：`.mindstrate/project.json`、`.mindstrate/config.json`、内置和自定义项目规则。
- [项目检测规则](project-detection-rules.zh-CN.md)：规则 schema 和安全边界。
- [系统页](system-pages.zh-CN.md)：架构页三层自定义模型（骨架、stack preset、custom）。
- [部署指南](deployment-guide.zh-CN.md)：部署模式和运维说明。

## 架构与设计

- [架构](architecture.zh-CN.md)：包边界和 import 规则。
- [Repo Scanner](repo-scanner.zh-CN.md)：外部仓库采集边界和工作流。
- [项目图谱](project-graph.zh-CN.md)：parser-first 项目图谱 pipeline 和查询接口。
- [ECS 记忆架构](ecs-memory.zh-CN.md)：可演化上下文基底、经验压缩谱系和记忆代谢模型。
- [上下文工程](context-engineering.zh-CN.md)：工作上下文装配策略。
