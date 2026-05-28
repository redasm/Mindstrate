# 项目图谱

Mindstrate Project Graph 会把仓库转换成带证据的图谱上下文，供人和 AI agent 使用。它优先来自 parser 和结构化抽取；只有在确定性事实存在后，才可选使用 LLM enrichment。

## 目标

项目图谱应回答实际工程问题：

- 重要文件、模块、组件和入口点在哪里？
- 哪些依赖和配置决定运行行为？
- 哪些文件是生成文件或高风险编辑区域？
- 某个变更可能影响哪些范围？
- 每个结论由哪些证据支持？

## Pipeline

图谱 pipeline 包含这些阶段：

```text
detect project -> scan files -> extract facts -> build graph -> analyze -> report/project
```

检测阶段使用声明式项目规则。扫描阶段遵守 ignore、generated、dependency 和 metadata-only 路径。抽取阶段使用 tree-sitter query pack、框架专用 parser、manifest、config 和 asset metadata。图谱事实写入时保留稳定 node ID、edge ID、provenance 和 evidence path。

## Parser-First 策略

源码事实应来自确定性抽取，而不是 LLM 猜测。源码语言默认方向是 tree-sitter query pack。结构化格式使用结构化 parser。Regex fallback 只用于小而稳定的模式，或用于尚未有兼容 parser adapter 的语言。

当前源码 parser 覆盖 TypeScript、TSX、JavaScript、JSX、Python、C# 和 C++，均通过 tree-sitter query pack。Lua 在找到兼容 grammar/runtime 路径前仍保留 regex fallback。

## Provenance

项目图谱数据区分：

- `EXTRACTED`：直接从源码、manifest、config 或 metadata 观察到。
- `INFERRED`：来自 LLM 或启发式 enrichment。
- `AMBIGUOUS`：可能正确但不确定，需要验证。

报告和图谱查询应保留 evidence path，方便 agent 在编辑前检查源文件。

## 输出

Mindstrate 可以写出：

- `PROJECT_GRAPH.md` 风格报告，
- `.mindstrate/` 下的机器可读图谱 artifact，
- Obsidian architecture 投影，
- node、module、flow 和 binding 页面，
- 带 bounded subgraph 的 CLI 和 MCP 查询响应。

图谱是索引和指南，不替代源码审查。

## 查询接口

重要操作包括图谱搜索、节点读取、邻居展开、最短路径、blast radius、任务导向查询、报告生成和变更影响分析。MCP 工具应返回聚焦上下文，而不是直接倾倒整个图。

团队模式下，Web UI 在浏览器中渲染同一份图谱：节点、依赖、风险信息、编辑前报告和成员添加的 structured overlay 都可以直接浏览和编辑。

![Web UI 项目图谱视图](images/project_graph.jpg)

## 隐私边界

Parser facts 在本地抽取。LLM enrichment 是可选能力，默认应接收受限 evidence snippet，而不是无限制源码。LLM 生成内容必须标记为 inferred 或 ambiguous。

## 评估

项目图谱质量应通过 fixture 和任务 prompt 评估。有效图谱应改善文件选择、架构问答、生成代码规避、影响分析和证据引用能力。
