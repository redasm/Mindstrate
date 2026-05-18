# ECS 记忆架构

Mindstrate 的 ECS 指 **Evolvable Context Substrate**，即"可演化上下文基底"。这里的 ECS 不是游戏引擎中的 Entity Component System，而是一种面向 AI agent 的长期记忆范式：记忆不是静态条目，也不是无限累积的文件堆，而是一个持续代谢的经验压缩谱系。

核心主张是：新的工程经验先以低压缩形态进入系统，再随着使用频率、反馈信号和模式识别，逐步向更高压缩形态演化；低价值、过期或冲突的记忆则被降权、归档、修正或遗忘。

```text
Episode -> Snapshot -> Summary -> Pattern -> Skill -> Rule -> Heuristic -> Axiom
```

## 为什么需要 ECS

现有 agent memory 实践大致分成两类：

- **Memory Backends**：以向量检索、图检索或混合检索为核心，把对话或事件提取成事实条目，解决"检索什么"的问题。
- **Context Substrates**：以结构化文件、项目笔记或可读上下文累积为核心，解决"agent 在什么上下文中工作"的问题。

两者都重要，但都没有完整回答记忆生命周期问题：记忆如何吸收、合并、压缩、升级、遗忘和反思冲突。ECS 的定位是把检索、上下文装配、技能沉淀和记忆治理放进同一个演化系统。

## 与现有范式的差异

| 维度 | Memory Backends | Context Substrates | Mindstrate ECS |
| --- | --- | --- | --- |
| 核心操作 | 检索 | 累积 | 代谢 |
| 记忆形态 | 静态条目 | 结构化文件 | 动态压缩谱系 |
| 时间维度 | 向后召回 | 向前累积 | 双向流动 |
| 知识演化 | 弱 | 弱到中等 | 显式压缩升级 |
| Memory 与 Skill | 分离 | 通常分离 | 同一谱系 |
| 遗忘机制 | 手动删除 | 归档或忽略 | 主动治理 |
| Canonical store | 向量库或图库 | 文件 | 带证据的上下文图 |

ECS 不否定检索。检索仍然是重要入口，但它不应是记忆系统的全部。Mindstrate 将 SQLite 中的 context graph 作为 canonical store；向量索引、Markdown、Obsidian 页面、bundle folder 和系统提示片段都是投影或加速层。

## 四层架构

### 第一层：记忆类型谱系

ECS 把 memory、skill 和 rule 视为同一经验压缩谱系上的不同成熟度，而不是三个割裂系统。八种 substrate 类型覆盖完整谱系，每一种都有明确的优先级权重，用于上下文装配排序：

| Substrate | 优先级 | 含义 |
| --- | --- | --- |
| `episode` | 0.30 | 低压缩的原始工作片段（一次 bug 修复、一次测试失败、一次会话观察）。 |
| `snapshot` | 0.45 | 项目或会话在某个时间点的结构化状态。 |
| `summary` | 0.62 | 多个 episode 的有界压缩。 |
| `pattern` | 0.72 | 反复出现的工程模式、风险或约定。 |
| `skill` | 0.82 | 可复用的操作过程（"如何定位 flaky test"、"如何发布 Team Server"）。 |
| `rule` | 0.90 | 高压缩、可执行的约束（"不要在 Mindstrate 主类上新增扁平代理方法"）。 |
| `heuristic` | 0.95 | 由多个 rule 支撑的稳定判断捷径。 |
| `axiom` | 1.00 | 项目级别不变量，其它一切都必须遵守。 |

Mindstrate 用两个正交维度表达这些记忆：

- `substrateType`：经验压缩谱系中的成熟度（即上表）。
- `domainType`：工程语义。已实现 12 种：`bug_fix`、`best_practice`、`architecture`、`convention`、`pattern`、`troubleshooting`、`gotcha`、`how_to`、`workflow`、`project_snapshot`、`session_summary`、`context_event`。

这样同一条工程事实可以随时间成熟，同时不丢失领域语义。一个 `bug_fix` 可以从 `episode` 起步、随后升级为 `pattern`，仍然保留 `bug_fix` 这个 domain 标签。

### 第二层：声明式上下文图

ECS 的核心数据结构是带证据的 context graph。主要对象是 context node 和 context edge。

节点保存内容、质量、置信度、项目范围、标签、状态、压缩层级、source reference、带证据的 metadata，以及自动递增的 `graphVersion`。边在十种关系类型中取值：

| 关系 | 语义 |
| --- | --- |
| `follows` | 两个事件之间的时序或因果次序。 |
| `causes` | 一个节点是另一个的成因。 |
| `supports` | 一项证据强化某个更高 substrate 的节点。 |
| `contradicts` | 两个节点表达不相容的主张；触发冲突检测。 |
| `generalizes` | 一个更高 substrate 节点抽象自较低 substrate。 |
| `instantiates` | 某条更一般的 pattern / rule 的具体实例。 |
| `derived_from` | 某个 compressor 从源节点派生出这个节点。 |
| `applies_to` | rule / skill 适用于某个目标节点（file、module、dependency）。 |
| `depends_on` | 由项目图谱抓取到的构建或运行时依赖。 |
| `observed_in` | 某个 episode 首次出现在某个事件或会话中。 |

项目图谱也是这个上下文图的一部分：文件、依赖、组件、调用、绑定、资产引用和风险提示都在 `metadata.evidence[].path` 中保留 evidence path。Agent 获取的不是一堆无来源笔记，而是可追溯、可查询、可审计的工作基底。

节点状态构成显式生命周期（`candidate -> active -> verified`，加上 `archived` 和 `conflicted`），治理决策因此是一等数据，而不是隐式标记。

### 第三层：记忆代谢引擎

记忆代谢循环是：

```text
Digest -> Assimilate -> Compress -> Prune -> Reflect
```

- `Digest`：把 raw events 规范化为 episode。除通用 session observation ingest 外，还有 5 个专用 ingestor 处理 Git activity、test 运行、LSP diagnostic、终端输出和用户反馈。
- `Assimilate`：把 episode 聚合成 snapshot、关系和项目事实。
- `Compress`：将重复或高价值上下文提升为 summary、pattern、skill 或 rule。共有六个协作 compressor 完成这件事：`summary`、`pattern`、`rule`、`high-order`、`feedback-cooccurrence`，以及给它们提供共享原语的 `substrate` 压缩。
- `Prune`：归档、降权或废弃低价值、过期、重复或被证伪的上下文。Prune 输出建议（`merge` / `archive` / `validate` / `improve` / `split`），每种建议有独立的自动应用置信度阈值；低于阈值的会进入 `pendingReview`，不会自动改图。
- `Reflect`：处理冲突，生成可审计修正候选，避免错误记忆静默升级。冲突检测同时使用嵌入相似度和显式 `contradicts` 边；反射会写一个 `candidate` 节点并配套一个 `actor: "metabolism.reflect"` 的 audit event。

代谢让记忆系统从"只进不出的仓库"变成会持续维护自身质量的认知工件。每次运行都通过 metabolism-run repository 持久化阶段统计，便于追溯质量回归；调度器可以按节奏触发。

### 第四层：内部-外部记忆协同

Mindstrate 区分 canonical memory 和 projection。

- 内部记忆：SQLite context graph、project graph facts、events、sessions、metabolism records。
- 外部投影，每一项都通过 `sourceNodeId`（或等价字段）回追到 canonical graph：
  - `<vault>/<project>/architecture/` 下的 Obsidian 文档。
  - `PROJECT_GRAPH.md`、项目快照等 Markdown report。
  - `@mindstrate/mcp-server` 暴露的 MCP resource。
  - 内化到 `AGENTS.md` 的 agent guidance 片段。
  - 用于嵌入 LLM 工具定义的 system prompt 片段。
  - 跨项目共享用的可移植 context bundle。
  - 以 JSONL 形式产出、每行附带 `sourceNodeId` 的 fine-tune 数据集候选。

外部投影可以被人类编辑、审查和分享，但不能悄悄变成竞争事实源。投影必须能追溯到图节点、边、证据和 audit metadata。外部反馈再通过 ingestion 或 overlay 回流到内部图中（例如 `importProjectGraphOverlayBlock` 会从架构页里读出用户编辑的 block 作为 overlay 节点写回图）。

## 上下文装配

Agent 不应手工拼接 session、snapshot、search result 和 warning。Context assembly 输出一个有边界的工作上下文包。装配出的 context 结构包含：

- `sessionContinuity` — 跨调用保持连续性的近期会话记忆。
- `projectSubstrate` — 当前项目快照与首要事实。
- `taskRelevantPatterns`、`applicableSkills`、`activeRules` — 按上面 substrate 优先级表排序后浮现的知识。
- `projectGraphContext` — 由 `currentFile` 加任务 token 作种子、走 1-hop 项目图扩展拉到的 file / module / dependency / asset 事实。
- `warnings`、`knownConflicts` — 风险面。
- `evidenceTrail` — 每一条浮现事实的显式证据路径。
- `retrievals` — 每个节点的 retrieval ticket；agent 必须通过 `memory_feedback_auto` 回报，让优先级选择器学习到底哪些知识真的帮上了忙。
- `summary` — 渲染给 agent 阅读的 Markdown。

ECS 的目标不是把所有相关事实都塞进 prompt，而是为当前任务装配最小可用上下文，并说明为什么包含、证据在哪里、还有哪些风险。

## Bundles

可移植上下文包允许稳定记忆切片在项目或团队之间迁移。Bundle 包含 nodes、edges、rules、skills、evidence 和 validation metadata。支持六条独立路径，全部都被 `validateBundle` 守住，安装阶段不能绕过治理：

- `createBundle` — 从 canonical store 切出一个子图。
- `validateBundle` — 结构和引用完整性检查。
- `installBundle` — 直接安装 payload；校验失败时 fail-closed。
- `publishBundle` — 把通过校验的 bundle 推到 registry。
- `installBundleFromRegistry` — 按 registry 引用拉取并安装。
- `installEditableBundleDirectory` — 安装人类可读的目录布局，适用于先评审再合并的工作流。

安装 bundle 时会创建可审计图条目，节点 metadata 原样保留，使 provenance 跨项目仍然可追溯。

## 治理原则

- **高风险自动变更默认保持 suggestive。** 进化引擎对 `merge`、`archive`、`validate` 这三类建议分别设置独立的自动应用置信度阈值；低于阈值的不会改图，而是进入 `pendingReview`。
- **废弃、归档、冲突解决和 internalization 都需要 audit metadata。** 冲突反射器每一次 accept / reject 都写一条配对的 audit event；进化引擎在每条已应用的建议上盖 `metadata.evolutionAudit` 戳。节点带自动递增的 `graphVersion`，便于事后取证。
- **conflicted 或 ambiguous knowledge 应可见，但不能静默提升为普通工作上下文。** 冲突以 `candidate` 节点 + `conflicted` 状态出现；只有显式 `accept` 才能升级到 `verified`。
- **LLM enrichment 只能增强已有确定性事实，不能替代 parser-first evidence。** 项目图先跑 tree-sitter 源码解析器；LLM enrichment 是可选的、在后跑、只写额外 metadata 并打上 `llmEnrichment: true` 标记。即使禁用 LLM，依然可以得到一份完整的确定性图。
- **记忆质量来自长期反馈、复用和压缩，不来自一次性摘要。** 每次装配出的 retrieval 都铸一个 `retrievalId`；agent 通过 `memory_feedback_auto` 回报，反馈循环据此调整源节点的 `positiveFeedback` / `negativeFeedback`，未来的优先级选择器会用这两个计数排序。

## 实现状态

下面是上述四层架构在代码中的 canonical 入口。路径相对 monorepo 根目录，可作为稳定依赖点供工具使用。

| 关注点 | 入口 |
| --- | --- |
| substrate / domain / status / relation / event 枚举 | `packages/protocol/src/models/context-graph.ts` |
| 上下文节点 + 边的 SQLite 仓库 | `packages/server/src/context-graph/context-node-repository.ts`、`context-edge-repository.ts` |
| 代谢编排 | `packages/server/src/metabolism/metabolism-engine.ts` |
| digest / assimilate / compress / prune / reflect 五阶段 | `packages/server/src/metabolism/{digest-engine,assimilator,compressor,pruner,reflector}.ts` |
| 压缩器（summary / pattern / rule / high-order / feedback-cooccurrence） | `packages/server/src/context-graph/*-compressor.ts` |
| 冲突检测 + 反射 | `packages/server/src/context-graph/conflict-detector.ts`、`conflict-reflector.ts` |
| 事件 ingestor（Git / test / LSP / terminal / user feedback） | `packages/server/src/events/event-ingestors.ts` |
| 上下文装配 DAG | `packages/server/src/context-graph/context-assembly-dag.ts` |
| 带嵌入相似度的优先级选择 | `packages/server/src/context-graph/context-priority-selector.ts` |
| 内化到 AGENTS.md / 项目快照 / system prompt / fine-tune JSONL | `packages/server/src/context-graph/context-internalizer.ts` |
| 可移植上下文 bundle | `packages/server/src/bundles/portable-context-bundle.ts` |
| Obsidian 投影（架构页 → RULE 节点） | `packages/server/src/project-graph/internalize-system-pages.ts` |
| MCP 工具表面 | `packages/mcp-server/src/tools/` |

需要更深架构上下文时参见 [`architecture.zh-CN.md`](architecture.zh-CN.md) 和 [`project-graph.zh-CN.md`](project-graph.zh-CN.md)。
