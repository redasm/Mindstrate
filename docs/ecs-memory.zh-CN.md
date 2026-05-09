# ECS 记忆架构

Mindstrate 的 ECS 指 **Evolvable Context Substrate**，即“可演化上下文基底”。这里的 ECS 不是游戏引擎中的 Entity Component System，而是一种面向 AI agent 的长期记忆范式：记忆不是静态条目，也不是无限累积的文件堆，而是一个持续代谢的经验压缩谱系。

核心主张是：新的工程经验先以低压缩形态进入系统，再随着使用频率、反馈信号和模式识别，逐步向更高压缩形态演化；低价值、过期或冲突的记忆则被降权、归档、修正或遗忘。

```text
Episode -> Snapshot -> Summary -> Pattern -> Skill -> Rule
```

## 为什么需要 ECS

现有 agent memory 实践大致分成两类：

- **Memory Backends**：以向量检索、图检索或混合检索为核心，把对话或事件提取成事实条目，解决“检索什么”的问题。
- **Context Substrates**：以结构化文件、项目笔记或可读上下文累积为核心，解决“agent 在什么上下文中工作”的问题。

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

ECS 把 memory、skill 和 rule 视为同一经验压缩谱系上的不同成熟度，而不是三个割裂系统。

- `episode`：低压缩的原始工作片段，例如一次 bug 修复、一次测试失败、一次会话观察。
- `snapshot`：项目或会话在某个时间点的结构化状态。
- `summary`：多个 episode 的有界压缩。
- `pattern`：反复出现的工程模式、风险或约定。
- `skill`：可复用的操作过程，例如“如何定位 flaky test”或“如何发布 Team Server”。
- `rule`：高压缩、可执行的约束，例如“不要在 Mindstrate 主类上新增扁平代理方法”。

Mindstrate 用两个维度表达这些记忆：

- `substrateType`：经验压缩谱系中的成熟度，例如 episode、snapshot、summary、pattern、skill、rule、heuristic 或 axiom。
- `domainType`：工程语义，例如 bug fix、convention、workflow、architecture、troubleshooting、session summary 或 project snapshot。

这样同一条工程事实可以随时间成熟，同时不丢失领域语义。

### 第二层：声明式上下文图

ECS 的核心数据结构是带证据的 context graph。主要对象是 context node 和 context edge。

节点保存内容、质量、置信度、项目范围、标签、状态、压缩层级和元数据。边保存 `follows`、`supports`、`contradicts`、`generalizes`、`instantiates`、`derived from`、`applies to`、`depends on` 和 `observed in` 等关系。

项目图谱也是这个上下文图的一部分：文件、依赖、组件、调用、绑定、资产引用和风险提示都带有 evidence path。Agent 获取的不是一堆无来源笔记，而是可追溯、可查询、可审计的工作基底。

### 第三层：记忆代谢引擎

记忆代谢循环是：

```text
Digest -> Assimilate -> Compress -> Prune -> Reflect
```

- `Digest`：把 raw events 规范化为 episode，例如 Git、测试、LSP、终端、用户反馈和会话观察。
- `Assimilate`：把 episode 聚合成 snapshot、关系和项目事实。
- `Compress`：将重复或高价值上下文提升为 summary、pattern、skill 或 rule。
- `Prune`：归档、降权或废弃低价值、过期、重复或被证伪的上下文。
- `Reflect`：处理冲突，生成可审计修正候选，避免错误记忆静默升级。

代谢让记忆系统从“只进不出的仓库”变成会持续维护自身质量的认知工件。

### 第四层：内部-外部记忆协同

Mindstrate 区分 canonical memory 和 projection。

- 内部记忆：SQLite context graph、project graph facts、events、sessions、metabolism records。
- 外部投影：Obsidian 文档、Markdown report、MCP resources、agent guidance、system prompt fragment、portable bundle、fine-tune dataset candidate。

外部投影可以被人类编辑、审查和分享，但不能悄悄变成竞争事实源。投影必须能追溯到图节点、边、证据和 audit metadata。外部反馈再通过 ingestion 或 overlay 回流到内部图中。

## 上下文装配

Agent 不应手工拼接 session、snapshot、search result 和 warning。Context assembly 应输出一个有边界的工作上下文包，包含 session continuity、project substrate、相关 patterns、适用 rules、active warnings、已知 conflicts、evidence trail 和 summary。

ECS 的目标不是把所有相关事实都塞进 prompt，而是为当前任务装配最小可用上下文，并说明为什么包含、证据在哪里、还有哪些风险。

## Bundles

可移植上下文包允许稳定记忆切片在项目或团队之间迁移。Bundle 应包含 nodes、edges、rules、skills、evidence 和 validation metadata。安装 bundle 时应创建可审计图条目，而不是绕过治理。

## 治理原则

- 高风险自动变更默认保持 suggestive。
- 废弃、归档、冲突解决和 internalization 都需要 audit metadata。
- conflicted 或 ambiguous knowledge 应可见，但不能静默提升为普通工作上下文。
- LLM enrichment 只能增强已有确定性事实，不能替代 parser-first evidence。
- 记忆质量来自长期反馈、复用和压缩，不来自一次性摘要。
