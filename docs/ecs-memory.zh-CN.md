# ECS 记忆架构

Mindstrate 使用 ECS 风格的上下文基底：工程经验不仅作为孤立文本片段保存，也作为图节点、关系、事件、投影和代谢记录保存。

## 这里的 ECS 是什么

本文中的 ECS 指 **Experience Context Substrate**，即“经验上下文基底”。

Experience Context Substrate 是一种记忆架构：系统会持续捕获原始工作经验，将其结构化、压缩、建立关系，并在后续任务中复用为工作上下文。它不把记忆看成一组扁平笔记或向量检索片段，而是把记忆建模为一个受治理的图，包含谱系、provenance、置信度、冲突、投影和维护循环。

对 Mindstrate 来说，ECS 表示：

- 经验会变成结构化上下文，而不是孤立文本；
- 上下文事实保留证据和 provenance；
- 重复经验可以从 episode 逐步成熟为 rule 或 skill；
- 陈旧或冲突的上下文会被显式治理；
- agent 获得的是装配好的工作上下文，而不是自己手工拼接搜索结果。

## 定位

Mindstrate 保留 retrieval-backed memory 的有效部分，同时增加图原生上下文基底。搜索仍然重要，但 canonical 结构是带证据的上下文图，可查询、压缩、投影和审计。

## 核心概念

ECS 记忆分离两个维度：

- `substrateType`：经验压缩谱系中的成熟度，例如 episode、snapshot、summary、pattern、skill、rule、heuristic 或 axiom。
- `domainType`：工程语义，例如 bug fix、convention、workflow、architecture、troubleshooting、session summary 或 project snapshot。

这样同一条工程事实可以随着时间成熟，同时不丢失领域语义。

## 图模型

主要图对象是 context node 和 context edge。节点保存内容、质量、置信度、项目范围、标签、状态、压缩层级和元数据。边保存 follows、supports、contradicts、generalizes、instantiates、derived from、applies to、depends on 和 observed in 等关系。

SQLite 仍是 canonical store。向量索引、Markdown 文件、Obsidian 页面和 bundle folder 是投影或加速层，不是独立事实源。

## 代谢循环

记忆代谢循环是：

```text
Digest -> Assimilate -> Compress -> Prune -> Reflect
```

Digest 把 raw events 规范化为 episodes。Assimilate 把事件聚合成 snapshots 和关系。Compress 将重复或高价值上下文提升为 summaries、patterns、skills 或 rules。Prune 归档或废弃低价值上下文。Reflect 处理冲突并创建可审计的修正候选。

## 上下文装配

Agent 不应手工拼接 session、snapshot、search result 和 warning。Context assembly 应输出一个工作上下文包，包含 session continuity、project substrate、相关 patterns、适用 rules、active warnings、已知 conflicts、evidence trail 和有边界的 summary。

## 投影

投影目标包括 graph knowledge view、session summary、project snapshot、Obsidian 文档、agent guidance、system prompt fragment 和 fine-tune dataset candidate。投影必须能追溯到图节点，不能悄悄变成竞争事实源。

## Bundles

可移植上下文包允许稳定记忆切片在项目或团队之间迁移。Bundle 应包含 nodes、edges、rules、skills、evidence 和 validation metadata。安装 bundle 时应创建可审计图条目，而不是绕过治理。

## 治理

高风险自动变更默认应保持 suggestive。废弃、归档、冲突解决和 internalization 都需要 audit metadata。conflicted 或 ambiguous knowledge 应可见，但不能静默提升为普通工作上下文。
