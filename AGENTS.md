# Mindstrate - Implementation Rules

## 目标

Mindstrate 当前处于允许 breaking changes 的开发阶段。实施时优先保证结构清晰、职责边界明确和长期可维护性，不保留旧 API 兼容层，不保留“以后可能用到”的代码。

## 架构边界

- `packages/protocol` 是协议与类型层，保持零业务运行时依赖。
- `packages/client` 只封装 Team Server HTTP client，不依赖 server/native 模块。
- `packages/server` 是核心运行时，`Mindstrate` 只负责生命周期和子域 API 组合。
- `packages/mcp-server` 默认走 `protocol + client`，本地模式才动态加载 `@mindstrate/server`。
- `packages/cli`、`packages/team-server`、`packages/web-ui`、`packages/obsidian-sync`、`packages/repo-scanner` 作为应用层，只通过公开子域 API 调用 server。

## Mindstrate 子域 API

不要在 `Mindstrate` 主类上新增扁平代理方法。新增能力必须放到明确子域中：

- `memory.knowledge.*`：知识写入、质量检查。
- `memory.snapshots.*`：项目快照 upsert / 查询。
- `memory.context.*`：ECS 图节点、边、冲突记录、图知识检索、反馈。
- `memory.assembly.*`：上下文策划与工作上下文装配。
- `memory.events.*`：Git、测试、LSP、终端、通用事件摄入。
- `memory.sessions.*`：会话生命周期、观察、压缩、恢复。
- `memory.metabolism.*`：代谢、压缩、冲突检测/反射、调度、剪枝。
- `memory.evaluation.*`：检索评估。
- `memory.projections.*`：投影、Obsidian 投影、internalization。
- `memory.bundles.*`：bundle 创建、校验、安装、发布。
- `memory.maintenance.*`：维护任务与统计。

## 重构规则

- 删除重复函数、重复模块、无意义抽象和 dead code。
- 删除 `v1` / `v2` / `old` / `backup` / `temp` / `deprecated` / `legacy` 这类版本堆叠实现。
- 不做兼容旧入口的 wrapper；调用方必须迁移到新边界。
- 文件按单一职责拆分；超过 200 行要优先检查是否职责混杂。
- 新增模块命名必须表达领域意图，禁止 `utils` / `helpers` / `common` 式杂物间。
- 项目检测器按语言拆分；不要把 Node/Python/Rust/Go 等检测逻辑重新堆进 `detector.ts`。
- Project Snapshot 的 ID、渲染、preserve block、upsert 行为保持分离。

## 修改约束

- 只修改与当前任务直接相关的文件。
- 不回滚用户未提交改动；看到无关 dirty 文件时隔离处理。
- 手工编辑使用 `apply_patch`。
- 不使用破坏性 git 命令，如 `git reset --hard` 或 `git checkout --`，除非用户明确要求。
- 提交前只 stage 本次任务相关文件。

## 编辑前工作流

非平凡代码变更前，必须先建立项目级影响面，避免只看局部文件直接修改：

- 运行或查询 Mindstrate 上下文装配，确认当前项目、相关规则和高优先级上下文。
- 运行 `mindstrate graph task before-edit "<目标文件/模块/子系统>"`。
  现在 before-edit 报告会从 Obsidian 投影出去的架构页（已被内化为 `RULE` 节点）回拉项目特有的 `Known Constraints` / `Do Not Edit Directly` / `Affected Chains` / `Recommended Verification`，不再只输出泛化文案。
- 运行 `mindstrate graph task impact "<目标文件/模块/子系统>"`。
- 阅读即将编辑的精确文件。
- 搜索直接调用方、生成输出、配置引用和 TypeScript 消费方。
- 如果变更跨越 C++ / TypeScript / plugin / config / asset 边界，编辑前必须说明受影响链路。
- 如果影响链路包含 generated files、assets、build files、plugins 或 TypeScript bindings，必须先识别 source of truth，再编辑。

## 项目架构页

- `mindstrate setup` / `mindstrate init` 会把项目架构总览（00-总览到 07-高风险文件）写到 Obsidian vault 的 `<vault>/<project>/architecture/` 下，**同时**把每页内化为 `RULE` + `ARCHITECTURE` 的 ECS 节点（id 形如 `architecture:system-page:<project>:<page-key>`），由 MCP `context_assemble` / `query_project_graph_task before-edit` / `search_graph_knowledge` 自动召回。
- 如果对项目尚不熟悉、或要改 C++ 反射 / UnrealSharp 生成 / TypeScript bindings / `.uproject` / `.uplugin` / `*.Build.cs` / `Content/**` / `Config/**`，先调用 `mindstrate_search_graph_knowledge` 或读 `<vault>/<project>/architecture/` 下的页，再开始编辑。
- 改了架构页之后，下一次 `setup` / `init` 会自动把新的 `metadata`（`classifications`、`knownConstraints`、`doNotEditTargets`、`affectedChain`、`recommendedVerification`）刷进 ECS RULE 节点；不需要手动再 import。

## 验证要求

按影响范围选择最小但足够的验证：

- server 核心变更：`cmd /c npm --prefix packages/server run build`
- 跨包 API 变更：同时构建 `packages/cli`、`packages/team-server`、`packages/mcp-server`、`packages/repo-scanner`、`packages/obsidian-sync`、`packages/web-ui`
- server 回归：`cmd /c npm --prefix packages/server test -- project-detector.test.ts project-snapshot.test.ts context-priority-selector.test.ts portable-context-bundle.test.ts coding-memory.test.ts session-store.test.ts metabolism-engine.test.ts projections.test.ts team-server-http.test.ts`
- repo-scanner 回归：`cmd /c npm --prefix packages/repo-scanner test -- scanner-service.test.ts`
- obsidian-sync 回归：`cmd /c npm --prefix packages/obsidian-sync test -- sync.test.ts markdown.test.ts`
- 提交前运行 `git diff --check`

如果 Vitest 在 Windows sandbox 中出现 `spawn EPERM`，使用已批准的 escalated test command 重新运行同一测试。
