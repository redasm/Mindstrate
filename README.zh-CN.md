# Mindstrate

语言：[中文](README.zh-CN.md) | [English](README.en.md)

Mindstrate 是面向 AI Coding Agent 的可演化上下文基底（Evolvable Context Substrate, ECS）。它把记忆视为持续代谢的经验压缩谱系：原始工作 episode 先进入系统，再随使用频率、反馈和模式识别逐步演化为 snapshot、summary、pattern、skill 和 rule，同时低价值或过期上下文会被归档、降权或遗忘。

Mindstrate 不只是向量检索后端，也不只是无限累积的文件堆。它把项目知识、会话连续性、外部工程信号和项目图谱沉淀为带证据、可治理、可投影的工作上下文，并通过 MCP、CLI、Team Server、Web UI 和 Obsidian 提供给 AI 工具使用。

Mindstrate 支持两种运行模式：

- **个人本地模式**：数据存放在当前项目 `.mindstrate/`，可选输出到 Obsidian。
- **团队模式**：成员本地 MCP 连接同一个 Team Server，共享团队知识和项目图谱上下文。

## 为什么需要 Mindstrate

- **ECS 记忆谱系**：Bug 修复、项目约定、架构决策、踩坑记录、工作流、会话摘要、技能和规则在同一压缩谱系中治理。
- **记忆代谢引擎**：Digest、Assimilate、Compress、Prune、Reflect 让记忆能吸收、合并、升级、降权、遗忘和冲突反思。
- **项目图谱上下文**：parser-first 的项目图谱，包含文件、依赖、组件、跨系统链路、风险提示、安全检查、证据路径和可编辑 overlays。
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

架构边界见 [架构](docs/architecture.zh-CN.md)。

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
mindstrate graph task before-edit "Source/Client" --project Client
mindstrate graph changes --source git # 将改动映射到图谱风险和安全问题
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

## 项目图谱与修改安全

Mindstrate 的项目图谱不只是文件索引。它会把抽取到的事实转换成 agent 可执行的修改前报告和影响面分析：

- `before-edit` / `impact` 报告会输出分类、已知约束、影响链路、source of truth、禁止直接编辑目标、必查项、推荐验证命令和相关 overlay。
- CLI 的 `mindstrate graph changes` / `mindstrate graph ingest` 会显示 safety issues，例如 generated 文件被直接修改、`.uplugin` 缺失 plugin dependency、Runtime module 依赖 Editor-only module。
- MCP 项目图谱工具也会在 `before-edit` / `impact` 报告中暴露 safety issues，方便 agent 在动手前识别全局风险。
- Obsidian 投影会生成系统级架构页、摘要页和 generated 明细页，并保留用户备注 / structured overlay，用于把人工确认回流到图谱。
- 高影响节点会带有 `impactTags`，例如 `build-critical`、`project-manifest`、`plugin-manifest`、`config-sensitive`、`asset-reference-sensitive`、`generated`、`do-not-edit`、`runtime-module`、`editor-only`。

Unreal 项目图谱增强包括：

- 解析 `.uproject` enabled plugins、`.uplugin` modules / dependency plugins、`*.Build.cs` public/private module dependencies。
- 抽取 `UCLASS`、`USTRUCT`、`UENUM`、`UFUNCTION`、`UPROPERTY` 并关联 native 到 TypeScript 使用面。
- 解析 `Config/*.ini` 中的 `/Script/Module.Class` 和 plugin 配置引用。
- 接入 Unreal Asset Registry 导出的 soft/hard asset references。
- 标记 generated/source-of-truth、generated roots、Config、Content asset、Runtime/Editor module 边界等风险信息。

## 文档

- [安装指南](docs/installation.zh-CN.md)：个人本地安装、Team Server 部署、团队成员接入、MCP 配置、LLM 服务商配置。
- [数据采集指南](docs/data-collection.zh-CN.md)：`repo-scanner`、Git/P4、hook、daemon、自定义 collector、标准 `ChangeSet`。
- [项目配置](docs/project-configuration.zh-CN.md)：`.mindstrate/project.json`、`.mindstrate/config.json`、内置规则、自定义 `.mindstrate/rules/*.json`。
- [项目检测规则](docs/project-detection-rules.zh-CN.md)：规则 schema、匹配条件、安全边界。
- [部署指南](docs/deployment-guide.zh-CN.md)：部署模式和运维说明。
- [Repo Scanner](docs/repo-scanner.zh-CN.md)：外部仓库采集边界和工作流。
- [项目图谱](docs/project-graph.zh-CN.md)：parser-first 项目图谱 pipeline 和查询接口。
- [ECS 记忆架构](docs/ecs-memory.zh-CN.md)：可演化上下文基底、经验压缩谱系和记忆代谢模型。
- [上下文工程](docs/context-engineering.zh-CN.md)：工作上下文装配策略。

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
