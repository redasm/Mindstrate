# Mindstrate

语言：[中文](README.zh-CN.md) | [English](README.en.md)

Mindstrate 是面向 AI Coding Agent 的记忆与上下文基底。它把项目知识、会话连续性、外部工程信号和项目图谱沉淀为可检索、可编辑、可共享的工作上下文，并通过 MCP、CLI、Team Server、Web UI 和 Obsidian 投影提供给 AI 工具使用。

Mindstrate 支持两种运行模式：

- **个人本地模式**：数据存放在当前项目 `.mindstrate/`，可选输出到 Obsidian。
- **团队模式**：成员本地 MCP 连接同一个 Team Server，共享团队知识和项目图谱上下文。

## 为什么需要 Mindstrate

- **可复用工程记忆**：Bug 修复、项目约定、架构决策、踩坑记录、工作流和会话摘要。
- **项目图谱上下文**：parser-first 的项目图谱，包含文件、依赖、组件、风险提示、证据路径和可编辑 overlays。
- **外部数据采集**：Git、Perforce、hook、daemon 和自定义 collector 统一放在 `repo-scanner`；框架只接收标准 `event`、`ChangeSet`、`bundle` 输入。
- **Agent 友好的 MCP 工具**：搜索、写入知识、组装上下文、恢复会话、查询项目图谱、记录反馈。
- **人类可编辑投影**：个人模式可把项目图谱输出到 Obsidian；团队模式可发布到 Team Server。

## 架构概览

```text
个人模式
AI 工具 -> MCP Server -> Mindstrate server runtime -> .mindstrate SQLite
                                      |
                                      +-> Obsidian projection

团队模式
AI 工具 -> 本地 MCP Server -> Team Server HTTP API -> 共享 Mindstrate runtime
                                      |
                                      +-> Web UI
```

主要包：

- `packages/protocol`：共享类型和协议契约。
- `packages/client`：Team Server HTTP client。
- `packages/server`：核心运行时和领域 API。
- `packages/mcp-server`：MCP tools/resources。
- `packages/cli`：`mindstrate` / `ms` 命令行。
- `packages/repo-scanner`：外部数据采集工具。
- `packages/obsidian-sync`：Obsidian 投影与同步。
- `packages/team-server`、`packages/web-ui`：团队部署入口。

架构边界见 [Architecture](docs/architecture.md)。

## 快速开始

### 1. 从源码构建

```bash
git clone https://github.com/redasm/Mindstrate.git
cd Mindstrate
npm install
npx turbo build
npm link
```

### 2. 初始化你的项目

```bash
cd /path/to/your/project
mindstrate setup
```

向导会让你选择：

- 个人本地模式，
- 团队成员客户端，
- 或 Team Server 部署配置。

非交互式个人模式：

```bash
mindstrate setup --mode local --tool opencode --yes
```

团队成员接入：

```bash
mindstrate setup \
  --mode team \
  --tool cursor \
  --team-server-url http://team-server:3388 \
  --team-api-key <key>
```

完整安装流程见 [安装指南](docs/installation.zh-CN.md)。

## 常用命令

```bash
mindstrate setup                     # 个人/团队/服务器部署向导
mindstrate init                      # 幂等生成项目快照和项目图谱
mindstrate mcp setup --tool cursor   # 写入 MCP 配置
mindstrate graph status              # 查看项目图谱投影状态
mindstrate graph query "auth flow"   # 搜索项目图谱节点
mindstrate graph ingest --changes changeset.json
mindstrate graph eval-dataset --out ./out/project-graph-eval
mindstrate vault export ~/Vault      # 导出知识到 Obsidian
mindstrate eval                      # 运行检索质量评估
```

外部数据采集：

```bash
mindstrate-scan ingest git --last-commit --project my-project
mindstrate-scan ingest p4 --recent 10 --project my-project
mindstrate-scan source add-git --name repo --project my-project --repo-path .
mindstrate-scan daemon
```

## 文档

- [安装指南](docs/installation.zh-CN.md)：个人本地安装、Team Server 部署、团队成员接入、MCP 配置、LLM 服务商配置。
- [数据采集指南](docs/data-collection.zh-CN.md)：`repo-scanner`、Git/P4、hook、daemon、自定义 collector、标准 `ChangeSet`。
- [项目配置](docs/project-configuration.zh-CN.md)：`.mindstrate/project.json`、`.mindstrate/config.json`、内置规则、自定义 `.mindstrate/rules/*.json`。
- [项目检测规则](docs/project-detection-rules.zh-CN.md)：规则 schema、匹配条件、安全边界。
- [部署指南](docs/deployment-guide.md)：更完整的部署和运维说明。
- [Repo Scanner 设计](docs/repo-scanner-design.md)：为什么外部采集放在框架外。
- [Project Graph Init Plan](docs/project-graph-init-plan.md)：项目图谱路线图和阶段记录。

## Runtime API 形态

`Mindstrate` 主类只负责生命周期和子域组合。业务能力放在明确子域中：

```ts
import { Mindstrate } from '@mindstrate/server';

const memory = new Mindstrate();
await memory.init();

await memory.knowledge.add(input);
await memory.snapshots.upsertProjectSnapshot(project);
const nodes = memory.context.queryContextGraph({ query: 'auth flow', project: 'web' });
const context = await memory.assembly.assembleContext('fix flaky test', { project: 'server' });
await memory.events.ingestEvent(event);
await memory.metabolism.runMetabolism({ project: 'server', trigger: 'manual' });

memory.close();
```

子域包括 `knowledge`、`snapshots`、`context`、`assembly`、`events`、`sessions`、`metabolism`、`evaluation`、`projections`、`bundles`、`maintenance`。

## 仓库结构

```text
Mindstrate/
├── docs/                 # 用户文档与架构文档
├── deploy/               # Team Server + Web UI Docker compose
├── install/              # 团队成员 MCP 安装包脚本
├── packages/
│   ├── protocol/
│   ├── client/
│   ├── server/
│   ├── mcp-server/
│   ├── cli/
│   ├── repo-scanner/
│   ├── obsidian-sync/
│   ├── team-server/
│   └── web-ui/
└── AGENTS.md             # 当前仓库的 AI 实施规则
```

## License

Apache-2.0
