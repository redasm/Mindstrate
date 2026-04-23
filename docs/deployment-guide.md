# Mindstrate 部署与使用指南

## 目录

- [环境要求](#环境要求)
- [安装构建](#安装构建)
- [部署模式](#部署模式)
  - [个人本地部署](#个人本地部署)
  - [团队服务器部署](#团队服务器部署)
- [配置](#配置)
- [接入 AI 编程工具](#接入-ai-编程工具)
  - [本地模式接入](#本地模式接入)
  - [团队模式接入](#团队模式接入)
- [知识采集](#知识采集)
- [知识管理](#知识管理)
- [会话记忆](#会话记忆)
- [Web UI](#web-ui)
- [P4 (Perforce) 集成](#p4-perforce-集成)
- [团队 Server API](#团队-server-api)
- [维护运营](#维护运营)
- [故障排查](#故障排查)

---

## 环境要求

| 项目 | 要求 |
|------|------|
| Node.js | >= 18.0.0 |
| npm | >= 10.0.0 |
| 操作系统 | Windows / macOS / Linux |
| 磁盘空间 | >= 100MB（知识库数据随使用增长） |
| Git | 可选，用于 git hook 自动采集 |
| p4 CLI | 可选，用于 Perforce 提交采集 |
| OpenAI API Key | 可选，用于高精度语义搜索和 LLM 知识提取 |

---

## 安装构建

```bash
# 1. 克隆仓库
git clone https://github.com/redasm/Mindstrate.git
cd Mindstrate

# 2. 安装依赖
npm install

# 3. 构建所有包（推荐：用 turbo 一次构建，自动处理依赖顺序）
npx turbo build

# 也可以单独构建各个包：
# npx tsc --build packages/protocol/tsconfig.json --force
# npx tsc --build packages/client/tsconfig.json --force
# npx tsc --build packages/server/tsconfig.json --force
# npx tsc --build packages/cli/tsconfig.json --force
# npx tsc --build packages/mcp-server/tsconfig.json --force
# npx tsc --build packages/team-server/tsconfig.json --force

# 4. 构建 Web UI（可选）
cd packages/web-ui && npx next build && cd ../..
```

验证安装：

```bash
mindstrate --help
```

---

## 部署模式

Mindstrate 支持两种部署模式：

```
┌─────────────────────────────────────────────────────────────┐
│  本地模式                      团队模式                      │
│                                                             │
│  成员 A                        成员 A    成员 B    成员 C    │
│    │                             │         │         │      │
│    ▼                             ▼         ▼         ▼      │
│  ┌────────┐                   ┌─────┐  ┌─────┐  ┌─────┐   │
│  │MCP     │                   │ MCP │  │ MCP │  │ MCP │   │
│  │Server  │                   │     │  │     │  │     │   │
│  └───┬────┘                   └──┬──┘  └──┬──┘  └──┬──┘   │
│      │                           │        │        │       │
│      ▼                           └───┬────┴────┬───┘       │
│  ┌────────┐                          ▼         │           │
│  │ 本地    │                   ┌──────────┐    │           │
│  │ SQLite  │                   │Team Server│◀──┘           │
│  └────────┘                   │  :3388    │               │
│                                └──────────┘               │
│  数据在本地                     数据集中存储、实时共享        │
│  适合个人使用                   适合团队使用                 │
└─────────────────────────────────────────────────────────────┘
```

### 个人本地部署

最简单的方式，数据存储在本地机器：

```bash
# 初始化
mindstrate init

# 接入 AI 工具
mindstrate mcp setup --tool cursor
```

数据默认存储在 `~/.mindstrate/`。

### 团队服务器部署

部署一个中心化的 Team Server，所有成员的知识自动汇聚、实时共享。

#### 第一步：启动 Team Server

在内网服务器或云服务器上：

```bash
# 设置环境变量
export TEAM_PORT=3388                              # 监听端口
export TEAM_API_KEY=your-team-secret-key           # API Key（客户端认证用）
export MINDSTRATE_DATA_DIR=/data/team-memory    # 数据目录
export OPENAI_API_KEY=sk-...                       # 可选，启用高精度搜索

# 启动
node packages/team-server/dist/server.js
```

验证：

```bash
curl http://your-server:3388/health
# 应返回: {"status":"ok","version":"0.1.0"}
```

#### 生产环境建议

使用 systemd 管理进程：

```ini
# /etc/systemd/system/mindstrate.service
[Unit]
Description=Mindstrate Team Server
After=network.target

[Service]
Type=simple
User=mindstrate
WorkingDirectory=/opt/mindstrate
ExecStart=/usr/bin/node packages/team-server/dist/server.js
Restart=always
RestartSec=5
Environment=TEAM_PORT=3388
Environment=TEAM_API_KEY=your-team-secret-key
Environment=MINDSTRATE_DATA_DIR=/data/team-memory

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl enable mindstrate
sudo systemctl start mindstrate
```

或使用 PM2：

```bash
pm2 start packages/team-server/dist/server.js \
  --name mindstrate \
  --env TEAM_PORT=3388 \
  --env TEAM_API_KEY=your-team-secret-key \
  --env MINDSTRATE_DATA_DIR=/data/team-memory
```

#### 第二步：团队成员接入

每个成员只需在自己的 AI 编程工具中配置 MCP Server，指向 Team Server：

```json
{
  "mcpServers": {
    "mindstrate": {
      "command": "node",
      "args": ["/path/to/packages/mcp-server/dist/server.js"],
      "env": {
        "TEAM_SERVER_URL": "http://your-server:3388",
        "TEAM_API_KEY": "your-team-secret-key"
      }
    }
  }
}
```

设置了 `TEAM_SERVER_URL` 后，MCP Server 自动切换到团队模式——不再使用本地存储，所有读写请求转发到 Team Server。

**效果：**
- 成员 A 在编程中解决了一个 bug，AI 将方案写入知识库
- 成员 B 遇到类似问题，AI 搜索时立刻找到成员 A 的方案
- 新成员 C 加入团队，配置 MCP 后立刻拥有团队全部知识

---

## 配置

### 环境变量

将 `.env.example` 复制为 `.env` 并按需修改：

```bash
cp .env.example .env
```

**通用配置：**

| 变量 | 说明 | 默认值 |
|------|------|--------|
| `OPENAI_API_KEY` | OpenAI API Key | 无（使用离线模式） |
| `MINDSTRATE_DATA_DIR` | 数据存储根目录 | `~/.mindstrate` |
| `MINDSTRATE_DB_PATH` | SQLite 数据库路径 | `<数据目录>/mindstrate.db` |
| `MINDSTRATE_VECTOR_PATH` | 向量索引存储目录 | `<数据目录>/vectors` |
| `MINDSTRATE_EMBEDDING_MODEL` | Embedding 模型 | `text-embedding-3-small` |

**团队模式配置（MCP Server 端）：**

| 变量 | 说明 | 默认值 |
|------|------|--------|
| `TEAM_SERVER_URL` | Team Server 地址（设置后启用团队模式） | 无（本地模式） |
| `TEAM_API_KEY` | 连接 Team Server 的 API Key | 无 |

**Team Server 配置：**

| 变量 | 说明 | 默认值 |
|------|------|--------|
| `TEAM_PORT` | 监听端口 | `3388` |
| `TEAM_API_KEY` | 认证 API Key（不设置则无需认证） | 无 |

### 离线模式 vs 在线模式

| | 离线模式（默认） | 在线模式 |
|---|---|---|
| 前提 | 无需 API Key | 需要 `OPENAI_API_KEY` |
| Embedding | 本地 hash-based | OpenAI text-embedding-3-small |
| 搜索精度 | 中等（词汇匹配） | 高（语义理解） |
| 知识提取 | 基于规则 | LLM 智能提取 |
| 会话压缩 | 基于规则 | LLM 智能压缩 |
| 网络依赖 | 无 | 需要访问 OpenAI API |
| 费用 | 免费 | OpenAI API 按量计费 |

建议：先用离线模式验证流程，确认有价值后再切换到在线模式提升精度。

---

## 接入 AI 编程工具

Mindstrate 通过 MCP (Model Context Protocol) 接入各种 AI 编程工具。

### 本地模式接入

```bash
# 一键生成配置
mindstrate mcp setup

# 仅为指定工具生成
mindstrate mcp setup --tool cursor
mindstrate mcp setup --tool opencode
mindstrate mcp setup --tool claude-desktop
```

**Cursor：** 生成 `.cursor/mcp.json`，重启 Cursor 生效。

**OpenCode：** 写入 `opencode.json`，重启 OpenCode 生效。

**Claude Desktop：**
```bash
mindstrate mcp setup --tool claude-desktop --global
```

### 团队模式接入

手动在 MCP 配置中添加 Team Server 信息：

**Cursor** (`.cursor/mcp.json`)：

```json
{
  "mcpServers": {
    "mindstrate": {
      "command": "node",
      "args": ["/path/to/packages/mcp-server/dist/server.js"],
      "env": {
        "TEAM_SERVER_URL": "http://192.168.1.100:3388",
        "TEAM_API_KEY": "your-team-secret"
      }
    }
  }
}
```

**OpenCode** (`opencode.json`)：

```json
{
  "mcp": {
    "mindstrate": {
      "type": "local",
      "command": "node",
      "args": ["/path/to/packages/mcp-server/dist/server.js"],
      "env": {
        "TEAM_SERVER_URL": "http://192.168.1.100:3388",
        "TEAM_API_KEY": "your-team-secret"
      }
    }
  }
}
```

### 接入后 AI 可用的工具

**知识工具：**

| Tool | 说明 | AI 何时调用 |
|------|------|------------|
| `memory_search` | 搜索知识库 | 解决 bug、实现功能、查找最佳实践时 |
| `memory_add` | 添加知识 | 解决了一个有价值的问题后 |
| `memory_feedback` | 对知识投票 | 知识有用或无用时 |
| `memory_feedback_auto` | 记录自动反馈 | 使用/拒绝/忽略了搜索到的知识后 |
| `memory_curate` | 上下文策划 | 开始复杂任务前，一次获取所有相关知识 |
| `memory_evolve` | 知识进化 | 定期维护时，分析并优化知识库 |

**会话记忆工具：**

| Tool | 说明 | AI 何时调用 |
|------|------|------------|
| `session_start` | 开始新会话 | 对话开始时 |
| `session_save` | 保存关键事件 | 做出决策、解决问题、遇到阻塞时 |
| `session_end` | 结束会话 | 对话结束前 |
| `session_restore` | 恢复上下文 | 需要回顾历史时 |

---

## 知识采集

### 手动添加

```bash
mindstrate add \
  --title "标题" \
  --type <类型> \
  --problem "问题描述（可选）" \
  --solution "解决方案" \
  --tags "tag1,tag2" \
  --language typescript \
  --framework react \
  --project my-app \
  --author your-name
```

> 注：建议优先使用 `mindstrate` 命令；如果未安装全局命令，也可以在任意命令前加上 `node packages/cli/dist/index.js`。

**知识类型（--type）：**

| 类型 | 值 | 适用场景 |
|------|-----|---------|
| 错误修复 | `bug_fix` | Bug 的原因和修复方案 |
| 最佳实践 | `best_practice` | 推荐的做法 |
| 架构决策 | `architecture` | 为什么选择某种架构 |
| 项目约定 | `convention` | 团队规范、编码约定 |
| 设计模式 | `pattern` | 可复用的代码模式 |
| 故障排查 | `troubleshooting` | 排查问题的路径 |
| 踩坑记录 | `gotcha` | 容易出错的地方 |
| 操作指南 | `how_to` | 怎么做某件事 |
| 工作流程 | `workflow` | 可执行的步骤化操作流程 |

### Git 自动采集

```bash
# 扫描最近 20 次 commit
mindstrate-scan ingest git --recent 20

# 扫描最近一次 commit
mindstrate-scan ingest git --last-commit

# 扫描指定 commit
mindstrate-scan ingest git --commit abc1234

# 预览（不实际写入）
mindstrate-scan ingest git --recent 10 --dry-run

# 安装 git hook（每次 commit 后自动采集）
mindstrate-scan hook install

# 卸载 hook
mindstrate-scan hook uninstall
```

### P4 (Perforce) 采集

```bash
# 扫描最近 10 个 P4 提交
mindstrate-scan ingest p4 --recent 10

# 只扫描特定 depot 路径
mindstrate-scan ingest p4 --recent 20 --depot //depot/MyProject/...

# 采集指定 changelist
mindstrate-scan ingest p4 --changelist 12345

# 预览
mindstrate-scan ingest p4 --recent 10 --dry-run
```

前提条件：
- `p4` 命令行工具已安装并在 PATH 中
- P4 连接已配置（`P4PORT`、`P4USER`、`P4CLIENT`）

### Git + P4 混用

```bash
# 采集 Git 提交
mindstrate-scan ingest git --recent 20

# 采集 P4 提交
mindstrate-scan ingest p4 --recent 20 --depot //depot/UnrealProject/...
```

所有知识进入同一个知识库，搜索时不区分来源。

---

## 知识管理

### 搜索

```bash
mindstrate search "useEffect memory leak"
mindstrate search "错误处理" --type convention --language typescript
mindstrate search "docker optimization" -v
mindstrate search "react" --top-k 10
```

### 浏览

```bash
mindstrate list
mindstrate list --type bug_fix
mindstrate list --language python
mindstrate list --limit 50
```

### 投票

```bash
mindstrate vote <知识ID> up      # 有用，+5 分
mindstrate vote <知识ID> down    # 无用，-10 分
mindstrate vote a1b2c3 up        # 支持部分 ID 前缀
```

### 删除

```bash
mindstrate delete <知识ID>
mindstrate delete <知识ID> --force    # 跳过确认
```

### 统计

```bash
mindstrate stats
```

---

## 会话记忆

解决 LLM 上下文窗口限制——新开窗口时，之前的工作进度自动恢复。

### 工作原理

```
会话 1（窗口 A）：
  AI → session_start("my-project")
  AI 工作中 → session_save({type:"decision", content:"用 jose 替代 jsonwebtoken"})
  AI 工作中 → session_save({type:"blocker", content:"refresh token 还没做"})
  AI → session_end()
  → 自动压缩为摘要

会话 2（新窗口）：
  AI → session_start("my-project")
  → 自动返回：上次摘要 + 未完成任务 + 关键决策 + 修改过的文件
  → AI 无缝继续工作
```

### 观察类型

| 类型 | 值 | 含义 |
|------|-----|------|
| 任务开始 | `task_start` | 开始一个新任务 |
| 决策 | `decision` | 做出了重要的技术决策 |
| 问题解决 | `problem_solved` | 解决了一个问题 |
| 文件变更 | `file_change` | 修改了重要文件 |
| 洞察 | `insight` | 发现了有价值的信息 |
| 阻塞 | `blocker` | 遇到了暂时无法解决的问题 |
| 进度 | `progress` | 完成了一个阶段性任务 |
| 决策路径 | `decision_path` | 为什么选择方案 A 而不是 B |
| 失败路径 | `failed_path` | 尝试过但行不通的方案 |
| 知识应用 | `knowledge_applied` | 检索到的知识被采纳使用 |
| 知识拒绝 | `knowledge_rejected` | 检索到的知识不适用 |

---

## Web UI

```bash
mindstrate web --dev          # 开发模式
mindstrate web                # 生产模式
mindstrate web --port 8080    # 自定义端口
```

默认地址：http://localhost:3377

| 页面 | 路径 | 功能 |
|------|------|------|
| Dashboard | `/` | 统计概览、分布图、最新知识 |
| Knowledge | `/knowledge` | 浏览、筛选、投票、删除 |
| Detail | `/knowledge/[id]` | 查看、编辑、投票、元数据 |
| Search | `/search` | 语义搜索 + 过滤 |
| Add | `/knowledge/new` | 添加知识表单 |

---

## 团队 Server API

Team Server 提供完整的 RESTful API：

### 认证

所有 `/api/*` 端点需要携带 API Key：

```bash
# Header 方式
curl -H "Authorization: Bearer your-api-key" http://server:3388/api/stats

# 或 x-api-key 方式
curl -H "x-api-key: your-api-key" http://server:3388/api/stats
```

未配置 `TEAM_API_KEY` 时无需认证（适合内网环境）。

### 端点列表

**知识：**

```
GET    /health                             健康检查（无需认证）
GET    /api/stats                          统计信息
POST   /api/knowledge                      添加知识
GET    /api/knowledge                      列出知识 (?type=&language=&limit=)
GET    /api/knowledge/:id                  获取详情
DELETE /api/knowledge/:id                  删除
PATCH  /api/knowledge/:id/vote             投票 (body: {direction:"up"|"down"})
POST   /api/search                         语义搜索 (body: {query, topK, ...})
POST   /api/sync                           批量同步 (body: {entries: [...]})
POST   /api/feedback                       记录自动反馈 (body: {retrievalId, signal, context?})
GET    /api/feedback/:knowledgeId          获取知识反馈统计
POST   /api/curate                         上下文策划 (body: {task, language?, framework?})
POST   /api/evolve                         运行知识进化 (body: {autoApply?, maxItems?})
```

**会话：**

```
POST   /api/session/start                  开始会话 (body: {project, techContext})
POST   /api/session/save                   保存观察 (body: {sessionId, type, content})
POST   /api/session/end                    结束会话 (body: {sessionId, summary?, openTasks?})
GET    /api/session/restore?project=xxx    恢复上下文
```

---

## 维护运营

### 定期维护

```bash
mindstrate doctor
```

维护任务：重新评分 → 标记低质量为「已废弃」→ 标记过期为「已过期」→ 输出报告。

建议频率：每周一次。

### 知识质量评分

| 因素 | 影响 |
|------|------|
| 基础分 | 50 分 |
| 正面投票 | +5 / 次 |
| 负面投票 | -10 / 次 |
| 使用次数 | +2 / 次（上限 +20） |
| 时效衰减 | -2 / 30 天 |
| 人工验证 | +15 |
| PR Review 来源 | +5 |
| AI 对话来源 | +2 |
| 自动反馈采纳率 | 最多 +10（采纳率高）/ -10（拒绝率高） |
| 进化改进次数 | +3 / 次（上限 +9） |
| 进化验证次数 | +5 / 次（上限 +10） |
| 合并其他知识 | +2 / 次（上限 +6） |
| 有操作步骤 | +3 |
| 有前置条件 | +1 |
| 有验证方法 | +1 |
| 有反模式 | +2 |

### 知识进化维护

```bash
# 运行知识进化引擎
mindstrate evolve

# 自动应用低风险改进
mindstrate evolve --auto-apply

# 限制分析数量
mindstrate evolve --max 50
```

进化引擎会：
1. 识别可合并的相似知识（相似度 80%-92%）
2. 找出低采纳率的知识（建议改进描述）
3. 标记应废弃的知识（低分/高拒绝率/长期不用）
4. 使用 LLM 自动改写低效知识（需 OPENAI_API_KEY）

### 检索质量评估

```bash
# 运行评估
mindstrate eval

# 查看趋势
mindstrate eval --trend
```

### 上下文策划

```bash
# 为任务自动组装知识包
mindstrate ctx "实现 React 表单验证"
mindstrate ctx "优化 Docker 构建" --language typescript --framework docker
```

### 数据备份

```bash
# CLI 导出
mindstrate export backup.json --pretty

# 直接备份数据目录
cp -r ~/.mindstrate /backup/mindstrate-$(date +%Y%m%d)

# Team Server 数据目录
cp -r /data/team-memory /backup/team-memory-$(date +%Y%m%d)
```

---

## 故障排查

**Q: 搜索结果不相关**

设置 `OPENAI_API_KEY` 切换到语义搜索模式，精度大幅提升。

**Q: 添加知识提示 "Duplicate detected"**

知识库中已存在相似度 > 92% 的知识。修改标题或描述使其差异更明显。

**Q: `mindstrate-scan ingest git` 没有采集到知识**

commit 可能太简单或匹配了跳过模式。用 `mindstrate-scan ingest git --recent 5 --dry-run` 预览。

**Q: MCP Server 连接失败**

1. 确认已构建：`ls packages/mcp-server/dist/server.js`
2. 手动测试：`mindstrate-mcp` 或 `node packages/mcp-server/dist/server.js`
3. 重新生成配置：`mindstrate mcp setup --tool <工具>`
4. 重启 AI 工具

**Q: Team Server 连接失败**

1. 确认服务运行：`curl http://server:3388/health`
2. 检查防火墙/端口是否开放
3. 检查 API Key 是否一致
4. 查看 Team Server 日志

**Q: 团队模式下知识没有同步**

1. 确认 MCP 配置中的 `TEAM_SERVER_URL` 正确
2. 确认 `TEAM_API_KEY` 与服务器端一致
3. MCP Server 启动日志应显示 `[team (http://...)]`

**Q: P4 采集报错**

1. 确认 `p4 -V` 能运行
2. 确认 `p4 info` 连接正常
3. 确认 changelist 存在：`p4 describe -s <CL号>`

**重置数据：**

```bash
rm -rf ~/.mindstrate && mindstrate init
```
