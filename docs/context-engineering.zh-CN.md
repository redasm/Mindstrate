# 上下文工程

Mindstrate 把上下文工程定义为：将已存记忆、项目图谱事实、会话和反馈组合成 AI agent 当前任务所需的有边界工作上下文。

## 目标

目标不是把所有相关事实都塞进 prompt，而是为当前任务装配最小可用上下文包，并提供足够证据和警告，帮助 agent 选择正确文件并避开已知风险。

## 输入

上下文装配可以使用：

- 恢复的会话摘要和未完成任务，
- 项目快照，
- 项目图谱 nodes、edges 和 reports，
- graph knowledge search 结果，
- workflows、conventions 和 active rules，
- conflicts 和 warnings，
- 最近事件与反馈信号。

## 装配策略

当成熟高置信图节点和 raw episode 描述同一事实时，assembler 应优先使用成熟节点。它应显式暴露冲突，在可用时包含 evidence path，并遵守 token 或字符预算。

推荐优先级：

```text
active conflicts and warnings
  -> project snapshot and graph entry points
  -> applicable rules and patterns
  -> task-specific knowledge and workflows
  -> session continuity and open tasks
  -> raw episodes only when needed
```

## 时间意识

上下文相关性具有时间性。最近项目事件、活跃会话和刚变更文件可以获得更高优先级。陈旧、冲突、deprecated 或绑定过期框架版本的知识应降权。

## 人类可读输出

上下文输出应能被 agent 直接使用，也能被人类检查。它应解释每个部分为什么被包含，尽可能引用证据，并建议后续项目图谱查询，而不是无限展开上下文。

## 反馈闭环

Agent 的采纳、拒绝、忽略，人工投票和任务结果，都应回流到质量和优先级评分。上下文装配不是静态格式化器，而是记忆治理循环的一部分。

## 非目标

上下文工程不会把 Markdown 变成唯一事实源，不替代项目图谱查询，也不绕过 provenance。它负责把已有记忆表面协调成可靠的工作上下文。
