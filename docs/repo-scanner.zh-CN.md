# Repo Scanner

`packages/repo-scanner` 是 Mindstrate 的外部仓库采集工具。它采集 Git 和 Perforce 信号，标准化为 change/event payload，并把这些 payload 送入 Mindstrate 运行时。

## 目标

Repo scanner 负责面向基础设施的采集工作：

- 发现最近提交或 changelist，
- 管理游标和重试，
- 收集 commit message、文件列表、diff 和元数据，
- 支持手动采集或 daemon 采集，
- 输出标准 Mindstrate event、changeset 或 bundle。

它不是知识存储、检索引擎、会话系统，也不是项目图谱事实源。

## 为什么独立

仓库扫描依赖本地工作副本、Git/P4 可执行程序、凭证、轮询、游标和失败恢复。这些是运维基础设施问题，不是核心记忆运行时问题。将 scanner 独立出来，可以避免 Git/P4 访问要求污染 `packages/server`，也让团队只在能访问仓库的机器上部署 scanner。

## 支持的工作流

常用命令：

```bash
mindstrate-scan ingest git --last-commit --project my-project
mindstrate-scan ingest git --recent 20 --project my-project
mindstrate-scan ingest p4 --recent 10 --project my-project
mindstrate-scan source add-git --name repo --project my-project --repo-path .
mindstrate-scan daemon
```

Scanner 既可用于一次性采集，也可作为 daemon 周期采集。

## 数据契约

Scanner 输出应被视为源证据，而不是最终知识。标准链路是：

```text
Git / Perforce / custom source
  -> repo-scanner
  -> normalized event or ChangeSet
  -> Mindstrate events/context/project graph APIs
  -> ECS graph, project graph, retrieval, projections
```

Server 决定如何存储、压缩、评分和暴露这些上下文。

## 游标与重试模型

Scanner 实现应优先使用增量游标，而不是反复扫描“最近 N 条”。Git 游标通常是 commit hash。Perforce 游标通常是 changelist number。失败项应记录并支持重试，且不能破坏已成功推进的游标状态。

## 边界规则

Repo scanner 可以依赖 `@mindstrate/protocol`、`@mindstrate/client`，以及在明确本地摄取场景下使用公开 server API。它不能重复实现知识抽取、检索排序、项目图谱存储或代谢逻辑。

## 扩展点

后续 scanner source 可以支持 Git mirror、托管 Git provider API、CI 事件、构建日志和企业自定义 source 系统。每个 source 都应先标准化为同一套 Mindstrate event/change 形状，再进入主系统。
