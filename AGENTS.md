# Mindstrate - Project Agent Rules

## 知识管理 (Mindstrate MCP)

### 会话生命周期（自动执行）
- **对话开始时**：立即调用 `session_start`，project 设为当前目录名
- **做出关键决策时**：调用 `session_save`，type 为 `decision`
- **解决问题后**：调用 `session_save`，type 为 `problem_solved`
- **尝试失败的方案后**：调用 `session_save`，type 为 `failed_path`
- **对话结束或用户说"结束/再见/bye"时**：调用 `session_end`，总结本次工作内容和未完成任务

### 知识检索（自动执行）
- 遇到 bug 或技术问题时，先用 `memory_search` 查询是否已有相关知识
- 开始复杂任务前，用 `memory_curate` 获取相关上下文
- 新对话开始时，用 `session_restore` 恢复上次的会话上下文

### 知识沉淀（自动执行）
- 解决了有价值的 bug 时，用 `memory_add` 记录（type: bug_fix）
- 发现最佳实践时，用 `memory_add` 记录（type: best_practice）
- 发现踩坑点时，用 `memory_add` 记录（type: gotcha）

### 反馈闭环（自动执行）
- 搜索结果被采用后，用 `memory_feedback_auto` 记录 signal: adopted
- 搜索结果不适用时，用 `memory_feedback_auto` 记录 signal: rejected
