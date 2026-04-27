# Mindstrate ECS 重构设计

## 1. 目的

本文档基于以下输入，给出一份以 `Mindstrate` 为基座的 ECS 重构方案：

- DeepSeek 分享中关于 `Camp 1: Memory Backends`、`Camp 2: Context Substrates` 和 `ECS` 的讨论
- 分享中引用的研究方向：经验压缩谱系、图记忆、记忆代谢、反思与遗忘、内外记忆协同
- 当前仓库的实际代码结构、数据模型与能力边界

本文档的目标不是写一篇概念文章，而是回答这几个工程问题：

1. `Mindstrate` 现在处于哪个阶段。
2. 如果要重构为 ECS，哪些资产必须保留，哪些要替换。
3. 新系统的数据模型、运行循环、包边界和迁移路径应该是什么。
4. 如何在不推翻现有产品能力的前提下，逐步演进到 ECS。

## 2. 结论先行

我的判断是：

- `Mindstrate` 当前是一个带有明显 `Camp 2` 雏形的 `Camp 1.5` 系统。
- 现有强项不是负担，而是 ECS 的良好起点：
  - 旧结构化知识条目的输入经验
  - `Session Memory`
  - `Project Snapshot`
  - `Curated / Assembled Context`
  - `Feedback Loop`
  - `Knowledge Evolution`
  - `Obsidian` 双向同步
- 真正缺失的不是“再加几个检索技巧”，而是：
  - 统一的 `经验压缩谱系`
  - 图原生上下文基底
  - 持续运行的 `Digest -> Assimilate -> Compress -> Prune -> Reflect` 代谢循环
  - 从“知识条目系统”向“上下文生命体”转变的运行时

因此，本次重构建议不是替换掉所有现有模块，而是把现有系统重新组织成一个新的 ECS 核心，并把现有检索、反馈、会话、项目快照等能力降落到 ECS 的不同层上。

## 3. 现状诊断

## 3.1 当前系统已经具备的 ECS 前体

基于当前仓库，我认为下面这些能力已经明显具备 ECS 的前体特征：

- `packages/server/src/storage/session-store.ts`
  - 已经把工作过程保存为 `observations`
  - 这是 `Episode` 的天然来源

- `packages/server/src/processing/session-compressor.ts`
  - 已经把会话观察压缩为摘要、决策、未完成任务
  - 这是 `Episode -> Snapshot` 的雏形

- `packages/server/src/project/snapshot.ts` 和 `Mindstrate.upsertProjectSnapshot`
  - 已经把项目心智模型固定为长期上下文
  - 这是 `Rule / Axiom` 级上下文种子

- `packages/server/src/retrieval/旧检索器.ts`
  - 已经不只是检索，还会组装 `knowledge / workflows / warnings`
  - 这是工作上下文装配，而不只是召回

- `packages/server/src/quality/feedback-loop.ts`
  - 已经记录采纳、拒绝、忽略等反馈
  - 这是代谢循环的评分信号

- `packages/server/src/metabolism`
  - 已经有轻量的合并、改进、废弃逻辑
  - 这是 `Compress / Prune` 的弱版本

- `packages/obsidian-sync`
  - 已经把知识映射到 Markdown
  - 这是上下文文件化的重要基础

## 3.2 当前系统距离 ECS 的核心差距

迁移前系统的核心对象是旧结构化知识条目；当前目标运行时已经切到图节点，其本质是“结构化知识条目”。这使系统更像一个高质量的知识库，而不是一个持续代谢的上下文基底。

主要差距有 6 个：

1. 没有统一谱系
   - 当前 `KnowledgeType` 是领域类型，如 `bug_fix / convention / workflow`
   - ECS 需要另一条正交维度：`Episode / Snapshot / Summary / Pattern / Skill / Rule / Heuristic / Axiom`

2. 没有图原生存储
   - 当前 `DatabaseStore` / `ContextGraphStore` 是单表 旧知识表
   - `VectorStore` 是 JSON 向量索引
   - 缺失节点关系、因果链、冲突关系、实例化关系、时序链

3. 没有持续摄取流
   - 当前 `session_save` 仍偏事件点式记录
   - 环境信号并未成为一等记忆输入，如终端输出、测试失败、LSP 诊断、Git 状态

4. 没有真正的压缩升级机制
   - 当前进化引擎仍围绕 旧结构化知识条目 做 merge / improve / deprecate
   - 还没有“低压缩经验自动升级为高压缩规则”的通道

5. 没有冲突治理闭环
   - 目前最多是低分、过期、拒绝率高
   - 还没有“新旧知识冲突 -> 标记 -> 反思 -> 修正 -> 保留谱系”的机制

6. 没有内外记忆协同层
   - 现在的上下文仍主要是注入型外部记忆
   - 缺少对“哪些稳定知识应该固化进 agent 行为”的路径设计

## 4. 重构原则

本次重构建议遵守以下原则：

1. 保留现有产品能力
   - 不能为了 ECS 理念把当前能工作的 CLI、MCP、Team Server、Web UI 打碎

2. 先引入新的核心模型，再迁移旧能力
   - 不能先改所有上层接口，再回头想底层数据结构

3. 谱系维度与领域维度分离
   - `bug_fix` 和 `workflow` 不应被删除
   - 但它们不再承担“记忆成熟度”的职责

4. Markdown 先做可读视图与协作副本，不立刻做唯一事实源
   - 这是高风险迁移，应放到后期

5. 演化必须可审计、可回滚、可验证
   - ECS 不是让系统随意自改，而是让它在治理框架下自我代谢

## 5. 目标态：ECS 系统总览

重构后的 `Mindstrate ECS` 应该具备四层架构。

## 5.1 第一层：经验压缩谱系层

新增一条记忆成熟度维度：

`Episode -> Snapshot -> Summary -> Pattern -> Skill -> Rule -> Heuristic -> Axiom`

每个节点同时保留两类标签：

- `substrateType`
  - 记忆在谱系中的层级
- `domainType`
  - 该记忆的业务语义，如 `bug_fix / architecture / workflow / convention`

这样可以避免当前模型中的混淆：

- `bug_fix` 可以是一次原始会话里的 `Episode`
- 也可以是压缩后的 `Summary`
- 也可以最后升级成一个跨项目复用的 `Rule`

## 5.2 第二层：声明式上下文图层

系统核心从“知识表 + 向量索引”升级为“上下文图 + 检索影子层”。

建议的核心对象：

### `ContextNode`

```ts
type SubstrateType =
  | 'episode'
  | 'snapshot'
  | 'summary'
  | 'pattern'
  | 'skill'
  | 'rule'
  | 'heuristic'
  | 'axiom';

type DomainType =
  | 'bug_fix'
  | 'best_practice'
  | 'architecture'
  | 'convention'
  | 'pattern'
  | 'troubleshooting'
  | 'gotcha'
  | 'how_to'
  | 'workflow'
  | 'project_snapshot'
  | 'session_summary'
  | 'context_event';

interface ContextNode {
  id: string;
  substrateType: SubstrateType;
  domainType: DomainType;
  title: string;
  content: string;
  project?: string;
  tags: string[];
  compressionLevel: number;
  confidence: number;
  qualityScore: number;
  status: 'candidate' | 'active' | 'verified' | 'deprecated' | 'archived' | 'conflicted';
  createdAt: string;
  updatedAt: string;
  lastAccessedAt?: string;
  accessCount: number;
  positiveFeedback: number;
  negativeFeedback: number;
  sourceRef?: string;
  metadataJson?: string;
}
```

### `ContextEdge`

```ts
type RelationType =
  | 'follows'
  | 'causes'
  | 'supports'
  | 'contradicts'
  | 'generalizes'
  | 'instantiates'
  | 'derived_from'
  | 'applies_to'
  | 'depends_on'
  | 'observed_in';

interface ContextEdge {
  id: string;
  sourceId: string;
  targetId: string;
  relationType: RelationType;
  strength: number;
  createdAt: string;
  updatedAt: string;
  evidenceJson?: string;
}
```

## 5.3 第三层：代谢引擎层

新增 `Metabolism Engine`，作为后台持续运行的治理引擎。

核心循环：

1. `Digest`
   - 摄取事件流，生成 `Episode`

2. `Assimilate`
   - 把相邻事件聚合成 `Snapshot`
   - 建立实体、因果、时序关系

3. `Compress`
   - 把多个 `Snapshot` 合并为 `Summary`
   - 从重复模式中抽取 `Pattern / Skill / Rule`

4. `Prune`
   - 对低价值、冲突未解、长期不活跃节点做降权、归档、废弃

5. `Reflect`
   - 对冲突、失效、规则泛化失败做复核与修正

## 5.4 第四层：上下文装配与内化层

上层 agent 不直接感知底层图细节，而是通过新的装配接口获得“当前最优工作上下文”。

同时，系统需要增加“记忆内化”机制：

- 稳定 `Rule / Heuristic / Axiom` 可输出到
  - `AGENTS.md` 建议
  - 项目 snapshot
  - 生成的 system prompt 片段
  - 未来可能的 LoRA / 微调接口

## 6. 当前模块到 ECS 的映射

## 6.1 保留并重用的模块

下面这些模块不需要删除，但需要重新定位：

### `DatabaseStore` / `ContextGraphStore`

- 当前职责：旧结构化知识条目 单表存储
- ECS 后职责：
  - 迁移为 `ContextGraphStore`
  - 负责 `nodes / edges / materializations / projections`

### `VectorStore`

- 当前职责：知识向量主检索
- ECS 后职责：
  - 退化为图检索的影子加速层
  - 只负责召回候选，不再承载真相结构

### `SessionStore`

- 当前职责：会话生命周期与摘要恢复
- ECS 后职责：
  - 成为 `Episode / Snapshot` 的主要来源之一
  - 会话表可保留，但不再是唯一的会话知识载体

### `SessionCompressor`

- 当前职责：把 observations 压缩为 summary
- ECS 后职责：
  - 成为 `Episode -> Snapshot` 与 `Snapshot -> Summary` 的压缩器之一

### 旧检索器

- 当前职责：语义检索 + curateContext
- ECS 后职责：
  - 升级为 `ContextAssembler`
  - 支持图遍历、谱系优先级、冲突屏蔽、时间窗口裁剪

### 旧演化引擎

- 当前职责：merge / improve / deprecate
- ECS 后职责：
  - 拆分进 `Compress / Prune / Reflect`
  - 不再围绕 旧结构化知识条目 单体优化，而围绕谱系演化

## 6.2 需要新增的核心模块

建议新增以下模块或 bounded contexts。

### `packages/server/src/context-graph`

负责图存储和图查询：

- `context-graph-store.ts`
- `context-node-repository.ts`
- `context-edge-repository.ts`
- `graph-query.ts`

### `packages/server/src/metabolism`

负责 ECS 的代谢循环：

- `digest-engine.ts`
- `assimilator.ts`
- `compressor.ts`
- `pruner.ts`
- `reflector.ts`
- `scheduler.ts`

### `packages/server/src/events`

负责多源事件摄取：

- `context-event.ts`
- `event-ingestors/session.ts`
- `event-ingestors/git.ts`
- `event-ingestors/test-run.ts`
- `event-ingestors/lsp.ts`
- `event-ingestors/user-feedback.ts`

### `packages/server/src/projections`

负责把图投影回现有产品需要的形态：

- `knowledge-projection.ts`
- `session-projection.ts`
- `project-snapshot-projection.ts`
- `obsidian-projection.ts`

## 7. 数据模型重构方案

## 7.1 协议层新增类型

协议层已经新增图模型，并且不再对外暴露旧结果形状。

建议新增：

- `packages/protocol/src/models/context-graph.ts`
- `packages/protocol/src/models/context-event.ts`
- `packages/protocol/src/models/metabolism.ts`

建议协议层新增这几类模型：

1. `ContextNode`
2. `ContextEdge`
3. `ContextEvent`
4. `MetabolismRun`
5. `ConflictRecord`
6. `ProjectionRecord`
7. `PortableContextBundle`

## 7.2 移除 旧结构化知识条目 兼容层，统一返回图视图

开发阶段不再保留外部 旧结构化知识条目 兼容层。

- 新写入统一落到 `ContextNode`
- 对外查询统一返回 `GraphKnowledgeView` / `GraphKnowledgeSearchResult`
- `projection_records` 记录图视图、会话摘要、项目快照、Obsidian 文档等派生目标
- 旧结构化知识条目 仅允许存在于尚未迁移的内部测试/历史模块中，不再作为新增数据或接口契约

目标接口：

- CLI `list / search / add` 返回 graph view
- Web UI 知识页读取 graph view
- MCP `memory_search / memory_add / memory_curate` 使用 graph-first payload

## 7.3 数据库存储建议

SQLite 仍可保留，但表结构需要扩展为图模型。

建议新增表：

```sql
CREATE TABLE context_nodes (...);
CREATE TABLE context_edges (...);
CREATE TABLE context_events (...);
CREATE TABLE node_embeddings (...);
CREATE TABLE projection_records (...);
CREATE TABLE conflict_records (...);
CREATE TABLE metabolism_runs (...);
```

开发阶段：

- `sessions` 继续作为会话运行态存储，同时把观察和结束摘要摄入图
- 旧知识表 不再接收新增知识、项目快照或 pipeline 写入
- 不再通过 projection 同步回旧接口

## 8. ECS 运行循环设计

## 8.1 Digest

`Digest` 负责把输入统一为 `ContextEvent`。

事件来源建议分三类：

### 被动捕获

- `session_save` 观察流
- 工具调用结果
- 测试命令结果
- Git commit / diff 摘要
- LSP 诊断
- 运行时报错

### 主动构建

- `memory_add`
- `mindstrate init`
- Obsidian 用户编辑
- 用户显式反馈

### 代谢生成

- 压缩生成的新摘要
- 反思得出的修正结论
- 冲突消解后产生的新规则

`Digest` 输出：

- `ContextEvent`
- 初始 `Episode` 节点
- 关联 `observed_in / follows` 边

## 8.2 Assimilate

`Assimilate` 负责把离散事件变成结构化上下文。

主要工作：

- 识别会话边界
- 聚合同一任务链上的事件
- 提取实体、文件、模块、依赖、错误类型
- 建立关系边
- 标记与已有节点的重叠、支持或冲突

输出：

- 更新后的 `Episode`
- 新的 `Snapshot`
- 基础关系图

## 8.3 Compress

`Compress` 是 ECS 的核心升级器。

触发条件建议：

- 三次以上相似 `Snapshot`
- 高频检索且高采纳
- 多次跨会话重复出现
- 多项目中重复验证

升级路径建议：

- `Episode -> Snapshot`
- `Snapshot -> Summary`
- `Summary -> Pattern`
- `Pattern -> Skill`
- `Skill -> Rule`
- `Rule -> Heuristic`
- `Heuristic -> Axiom`

当前的 `旧演化引擎.mergeKnowledge` 可以作为这里的参考起点，但必须从“文本拼接式合并”升级为“谱系化合并”：

- 保留来源节点
- 建 `derived_from / generalizes / instantiates` 边
- 记录压缩原因和证据

## 8.4 Prune

`Prune` 负责遗忘和归档。

遗忘不等于删除。建议区分：

- `deprecated`
  - 被明确判定为不应再使用

- `archived`
  - 仍保留，但默认不进入工作上下文

- `conflicted`
  - 有冲突，等待反思或人工处理

遗忘信号建议包括：

- 长期未访问
- 低质量分
- 高拒绝率
- 被高层规则完全覆盖
- 与项目当前版本环境不匹配

## 8.5 Reflect

`Reflect` 负责把“冲突”和“失败”变成新知识，而不是噪声。

典型场景：

- 旧规则在新版本框架失效
- 两条知识彼此矛盾
- 某个 `Skill` 在不同项目中结果不一致

反思输出不应直接改写旧知识，而应：

1. 生成 `ConflictRecord`
2. 形成候选修正节点
3. 更新节点状态和边关系
4. 必要时请求人工确认

## 9. 检索与上下文装配重构

## 9.1 从 旧检索器 变成 Context Assembler

旧检索器的主逻辑曾是：

- embed query
- vector search
- metadata filter
- score rerank

ECS 之后，建议改成：

1. 图内候选召回
   - 先根据项目、会话、文件、错误实体定位子图

2. 向量影子召回
   - 用 embedding 找近邻候选节点

3. 谱系裁剪
   - 同一事实若已有 `Rule`，默认不再展开全部底层 `Episode`

4. 冲突治理
   - `conflicted` 节点只在需要时显式暴露

5. 上下文预算管理
   - 根据 token 预算输出不同压缩层级内容

## 9.2 新的 context_assemble

`context_assemble` 应成为 ECS 的首要对外入口。

返回内容建议升级为：

- `sessionContinuity`
- `projectSubstrate`
- `taskRelevantPatterns`
- `applicableSkills`
- `activeRules`
- `knownConflicts`
- `warnings`
- `evidenceTrail`
- `summary`

简化理解：

- 当前系统给 agent 的是“几条相关知识”
- ECS 要给 agent 的是“当前任务所在的认知地形图”

## 10. Obsidian 与文件系统角色重估

当前 README 已明确：

- SQLite 仍是事实源
- Vault 主要是镜像和有限回写

在 ECS 阶段，我建议把 Obsidian 定位升级为：

- 人类可读视图
- 人类修正入口
- 可移植上下文包的编辑器

但不建议在第一阶段就把 Markdown 升级为唯一事实源，原因是：

1. 还没有图级版本治理
2. 还没有多人冲突解决语义
3. 还没有稳定的 projection 回写机制

更稳妥的顺序是：

- 先让 Markdown 成为 ECS 的一种投影视图
- 再让部分高层节点支持可控回写
- 最后才评估是否把某些 bundle 或 project substrate 升级为 canonical source

## 11. 可移植上下文包

根据分享内容和 ECS 思想，`Mindstrate` 非常适合引入可移植上下文包。

建议命名可以是：

- `Context Bundle`
- `Memory Pack`
- `Portable Substrate`

建议目录结构：

```text
.mindstrate/
  bundles/
    react-query-cache-invalidation/
      bundle.json
      nodes/
      edges/
      rules.md
      skills.md
      invariants.md
```

推荐能力：

- `mindstrate bundle create`
- `mindstrate bundle install`
- `mindstrate bundle validate`
- `mindstrate bundle publish`

这会成为未来社区化的基础，也能把 ECS 和 Skill 生态连接起来。

## 12. 包和接口层面的迁移方案

## 12.1 `protocol`

新增 ECS 模型，但不立刻移除旧模型。

建议顺序：

1. 先增量增加 `context-graph.ts`
2. 再让 MCP / client / server 统一使用 graph view 类型
3. 最后移除旧接口和兼容 projection

## 12.2 `server`

`Mindstrate` facade 保留现名，但语义转为 ECS graph-first。

建议新增 facade 方法：

- `ingestEvent`
- `runDigest`
- `runAssimilation`
- `runCompression`
- `runPruning`
- `runReflection`
- `queryContextGraph`
- `assembleWorkingContext`
- `readGraphKnowledge`
- `queryGraphKnowledge`

## 12.3 `mcp-server`

MCP 是最适合暴露 ECS 能力的入口。

建议保留工具名时也切换 payload 为 graph-first，同时新增：

- `context_ingest_event`
- `context_query_graph`
- `context_conflicts`
- `metabolism_run`
- `bundle_create`
- `bundle_install`

迁移期建议：

- `memory_search` 仍可用
- 但底层实现逐步切到图查询 + projection

## 12.4 `web-ui`

Web UI 后续应该新增 ECS 可视化：

- 谱系视图
- 冲突面板
- 代谢运行历史
- 项目上下文图
- bundle 管理

当前知识列表页不应删除，而应变成一个投影视图页面。

## 13. 分阶段实施计划

## 阶段 0：文档与协议校准

目标：

- 确认 ECS 设计边界和兼容策略

产出：

- 本文档
- 新协议草案
- 非目标清单

非目标：

- 本阶段不改数据库
- 不改 CLI 外观
- 不改 Web UI

## 阶段 1：引入谱系与图协议

目标：

- 在 `protocol` 中定义 ECS 的核心模型
- 在 `server` 中建立最小图存储骨架

任务：

1. 新增 `ContextNode / ContextEdge / ContextEvent`
2. 新增 `ContextGraphStore`
3. 新增最小图查询接口
4. 不再保留旧 旧结构化知识条目 写入和外部接口

验收：

- 能创建、读取、关联节点
- 不破坏现有测试

## 阶段 2：把会话流接入 Digest

目标：

- 让 `SessionStore` 和 `session_save` 成为 ECS 的摄取入口

任务：

1. 每次 observation 同步生成 `ContextEvent`
2. 建立 `Episode` 节点
3. 会话结束时自动生成 `Snapshot`
4. 让 `session_restore` 同时能读旧会话和新投影

验收：

- 一次真实会话能在图中形成事件链

## 阶段 3：移除 旧结构化知识条目 外部兼容层

目标：

- 让新增知识写入图，并通过 graph view 对外呈现

任务：

1. `memory_add` 写入 `ContextNode`
2. `ProjectionTarget.GRAPH_KNOWLEDGE` 记录 graph view 派生
3. curation/search 使用图检索结果

验收：

- `mindstrate add / mindstrate search / memory_search` 返回 graph view
- 新增数据不再写入 旧知识表

## 阶段 4：实现第一版代谢引擎

目标：

- 跑通 `Digest -> Assimilate -> Compress -> Prune`

任务：

1. 从会话生成 `Episode / Snapshot`
2. 三个相似 `Snapshot` 合成 `Summary`
3. 高频采纳 `Summary` 升级为 `Pattern`
4. 低价值节点归档或废弃

验收：

- 有代谢运行记录
- 有谱系可追踪
- 不依赖人工手动合并

## 阶段 5：实现 Reflect 与冲突治理

目标：

- 系统能处理冲突，而不是只做静态淘汰

任务：

1. 增加 `ConflictRecord`
2. 检测 `contradicts` 边
3. 输出待反思候选
4. 生成修正节点和审计日志

验收：

- 同一规则在不同版本场景冲突时，系统能标注和分流

## 阶段 6：引入 Bundle 与社区能力

目标：

- 让高价值记忆可移植、可分享、可版本化

任务：

1. 增加 `PortableContextBundle`
2. CLI 支持导入导出 bundle
3. Obsidian / 文件系统支持 bundle 编辑
4. 团队模式支持 bundle 发布和安装

验收：

- 一个项目里抽取的高价值规则和技能可安装到另一个项目

## 14. 风险与对策

## 14.1 风险：系统复杂度陡增

对策：

- 先兼容、后替换
- 所有新模型先作为新增层，而不是先拆旧层

## 14.2 风险：图存储做成大而无当

对策：

- 初期只实现最少关系：
  - `follows`
  - `derived_from`
  - `generalizes`
  - `contradicts`
  - `applies_to`

## 14.3 风险：Markdown 和数据库双写漂移

对策：

- 前中期仍坚持数据库图为主
- 文件系统先做 projection

## 14.4 风险：自演化改坏知识

对策：

- 所有高风险代谢动作都要留审计记录
- 改写与升级默认走候选态
- 保留人工确认入口

## 15. 建议的近期实施顺序

如果从当前仓库直接开始干，我建议顺序是：

1. 新增 ECS 协议模型和设计文档
2. 增加图存储骨架，不改现有对外接口
3. 把 `session_save` 接进 `Digest`
4. 把 `session_compressor` 升级为 `Episode -> Snapshot`
5. 把 `knowledge_evolution` 拆成 `Compress / Prune`
6. 重写 `context_assemble`，让它从图中装配上下文
7. 最后再引入 bundle 和更强的 Reflect

## 16. 一句话总结

以 `Mindstrate` 为基座重构 ECS，正确方向不是“把当前知识库推倒重做”，而是：

把当前已经很强的 `Knowledge + Session + Snapshot + Feedback + Evolution + Obsidian` 体系，重新组织成一个以 `经验压缩谱系 + 声明式上下文图 + 记忆代谢引擎 + 上下文装配层` 为核心的新架构，让系统从“会检索的知识库”演进成“会持续代谢的上下文基底”。

