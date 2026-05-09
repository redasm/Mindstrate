# Mindstrate 架构

本文是 Mindstrate 的正式包边界说明，定义每个 package 的职责、允许依赖和新增能力的落点。

## 分层模型

```text
@mindstrate/protocol
  -> @mindstrate/client
  -> @mindstrate/server
  -> applications: cli, mcp-server, team-server, web-ui, obsidian-sync, repo-scanner
```

`protocol` 是共享契约层。`client` 是 Team Server HTTP 客户端。`server` 是本地核心运行时和领域实现。应用层 package 通过公开 API 组合为 CLI、MCP、Team Server、Web UI、Obsidian 投影和 repo scanner。

更具体的依赖方向如下：

```text
                         @mindstrate/protocol

                       (zero runtime deps, types only)

                                   ^
                                   |
                            used by everyone
                                   |
                  +----------------+----------------+
                  |                                 |
                  v                                 v
          @mindstrate/client                @mindstrate/server

         (HTTP client, fetch only)      (SQLite + OpenAI + ingestion
                                          + retrieval + quality)
                  ^                                 ^
                  |                                 |
         +--------+--------+              +---------+---------+
         |                 |              |         |         |
         v                 v              v         v         v
     mcp-server       any 3rd party      cli   team-server  web-ui
                      using the HTTP API                     |
                                                             v
                                                        obsidian-sync
                                                        (uses server)
```

## Package 职责

| Package | 职责 | 边界 |
| --- | --- | --- |
| `packages/protocol` | 共享 DTO、枚举、工具 schema、图和记忆模型 | 不引入业务运行时依赖 |
| `packages/client` | Team Server HTTP API 客户端 | 不依赖 server/native 模块 |
| `packages/server` | 核心运行时、SQLite 存储、检索、项目图谱、会话、代谢、投影 | 不负责 MCP、HTTP framing 或 UI |
| `packages/mcp-server` | MCP tools/resources | 默认使用 `protocol + client`；本地模式动态加载 server |
| `packages/cli` | `mindstrate` / `ms` 命令行工作流 | 只调用公开 server/client API |
| `packages/team-server` | 团队 HTTP API 和共享运行时部署 | 通过 server facade/domain API 工作 |
| `packages/web-ui` | 团队 Web UI | 通过公开 server/client 边界访问数据 |
| `packages/obsidian-sync` | Obsidian 投影和受控同步 | 使用 server projection API |
| `packages/repo-scanner` | 外部仓库事件采集 | 向 Mindstrate 输入标准化 changes/events |

## Runtime API 形态

`Mindstrate` 主类只负责生命周期和子域组合。新增能力应放入明确子域，不应继续在主类上增加扁平代理方法。

主要子域：

- `memory.knowledge.*`：知识写入与质量检查。
- `memory.snapshots.*`：项目快照 upsert 与查询。
- `memory.context.*`：ECS 图节点、边、冲突、反馈和图检索。
- `memory.assembly.*`：上下文策划与工作上下文装配。
- `memory.events.*`：Git、测试、LSP、终端、会话和通用事件摄取。
- `memory.sessions.*`：会话生命周期、观察、压缩和恢复。
- `memory.metabolism.*`：digest、压缩、反思、剪枝和调度。
- `memory.evaluation.*`：检索与图谱评估。
- `memory.projections.*`：Obsidian、internalization 和其他投影。
- `memory.bundles.*`：可移植上下文包创建、校验、安装和发布。
- `memory.maintenance.*`：维护任务与统计。

## Import 规则

`protocol` 不能导入任何 `@mindstrate/*` package 或业务运行时依赖。`client` 只能依赖 `protocol` 和平台中立的 HTTP 能力。`mcp-server` 不能静态导入 `server`；本地模式必须动态加载。应用层 package 应通过公开 API 使用能力，不应绕过边界读取 server 内部模块。

## 构建顺序

推荐构建顺序：

```text
protocol -> client -> server -> application packages
```

跨包 API 变更需要构建受影响消费者，尤其是 `cli`、`team-server`、`mcp-server`、`repo-scanner`、`obsidian-sync` 和 `web-ui`。

## 新增 Package

新增 package 时，先定义领域职责，再添加 `package.json`、`tsconfig.json`、必要的构建 pipeline 和依赖限制。同步更新本文档以及用于强制边界的 lint/build 规则。

## 设计规则

优先保持边界少而清晰。不要新增 `utils`、`common` 或兼容 wrapper 式 package。一个 package 只有在拥有稳定领域或部署入口时才应存在。
