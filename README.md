# Mindstrate

AI 记忆与上下文基底，让 agent 和团队把分散经验沉淀成可复用的工作上下文。

团队中任何人安装后，工作过程中产生的问题解法、项目约定、架构决策、流程经验都会自动写入**中心化的团队知识服务器**，所有成员的 AI 助手实时共享团队经验。同时解决 LLM 上下文窗口限制问题，新开会话也能恢复上次的工作进度。

## 核心架构

```
成员 A (Cursor)        成员 B (OpenCode)      成员 C (Claude Desktop)
     │                      │                      │
     │ MCP                   │ MCP                   │ MCP
     ▼                      ▼                      ▼
┌──────────┐          ┌──────────┐          ┌──────────┐
│MCP Server│          │MCP Server│          │MCP Server│
│(本地进程) │          │(本地进程) │          │(本地进程) │
└────┬─────┘          └────┬─────┘          └────┬─────┘
     │                      │                      │
     └──────── HTTP ────────┴──────────────────────┘
                     │
                     ▼
           ┌──────────────────┐
           │  Team Server     │  ← 内网 / 云服务器
           │  (中心化知识库)   │
           │  知识自动汇聚共享 │
           └──────────────────┘
```

**两种运行模式：**
- **本地模式**（默认）：知识存储在本地，适合个人使用
- **团队模式**：所有成员连接同一个 Team Server，知识实时共享

## 功能特性

**知识记忆（RAG）**
- 手动写入 + 外部数据源工具（Git / P4 / hook）+ LLM 提取
- 语义搜索 + 质量评分 + 自动淘汰过期知识
- **时序感知检索**：不同知识类型使用不同时间衰减窗口；显式过期知识会被降权
- 支持 9 种知识类型：Bug 修复、最佳实践、架构决策、项目约定、设计模式、故障排查、踩坑记录、操作指南、工作流程
- **质量门禁**：写入前自动检查结构完整性、一致性，防止低质量知识入库
- **向量维度校验**：防止 Embedding 模式切换时的静默数据损坏

**自动反馈闭环**
- 检索到的知识自动追踪使用情况（采纳/拒绝/忽略）
- 根据反馈信号自动调整知识质量分
- 高拒绝率的知识自动标记为需改进
- 无需人工投票即可实现知识质量自我优化

**知识自动进化**
- 自动识别可合并的相似知识
- 基于反馈轨迹发现需要改进的低效知识
- LLM 辅助自动改写低采纳率的知识
- 自动废弃长期无人使用或频繁被拒绝的知识
- **后台轻量整理模式**：`background` 模式只做扫描和报告，不自动改写知识，适合定期巡检
- 进化谱系追踪——每条知识的完整成长历史

**上下文策划**
- 给定任务描述，自动组装完整知识包
- 分类返回：解决方案 + 工作流步骤 + 踩坑警告
- 替代手动搜索，一次获取执行任务需要的所有知识

**工作上下文装配**
- 新增一等上下文入口：自动组合 `Session Memory + Project Snapshot + Curated Knowledge`
- 适合复杂任务开工前调用，减少 AI 助手手动拼装上下文
- MCP 提供 `context_assemble` 工具，团队模式 / 本地模式行为一致

**检索质量评估**
- 构建评估数据集（问题 → 期望知识）
- 定期运行评估，跟踪精确率/召回率/F1/MRR 趋势
- 精度下降时自动预警

**可执行知识（ActionableGuide）**
- 知识不仅是描述，更包含可执行的步骤化指导
- 前置条件、步骤列表、验证方法、反模式
- Workflow 类型知识自带完整操作流程

**会话记忆（Session Memory）**
- 新会话自动恢复上次的摘要、未完成任务、关键决策
- AI 工作过程中保存关键事件，结束时自动压缩为摘要
- 支持记录决策路径、失败路径、知识应用/拒绝等事件
- 跨会话保持项目进度连续性

**Obsidian 双向同步（个人推荐）**
- 知识自动镜像为 Markdown + Frontmatter，存入指定 Obsidian Vault
- 路径布局：`<vault>/<项目>/<类型>/<标题>--<id8>.md`
- 直接在 Obsidian 编辑笔记会回写 Mindstrate（含重新索引）
- **可编辑 / 镜像双模式**：`architecture/convention/workflow/...` 允许安全回写；`bug_fix/gotcha/troubleshooting` 默认镜像只读，不接受 Vault 改写
- **冲突保护**：旧的 Vault 快照不会覆盖较新的 Mindstrate 内容；镜像型知识的 Vault 删除也不会删掉主知识
- 在 Obsidian 中享受 Graph View、双向链接、移动端、丰富插件
- `<!-- mindstrate:end -->` 标记下方的内容视为私人笔记，不会被同步覆盖
- SQLite 仍是事实源，向量检索/进化/反馈闭环不受影响

**项目快照（mindstrate init 自动生成）**
- 一键检测项目（语言、框架、依赖、入口、Git）并写入「项目架构知识」
- 让 AI 在局部修改时也能看到全局心智模型与不变量（如 "Model 在 startup 初始化，runtime 可假定非空"）
- `## Critical Invariants` / `## Architecture & Lifecycle` / `## Conventions` 段落使用 `<!-- preserve -->` 标记，跨次 `mindstrate init` 永不丢失你写过的内容
- 完全幂等：基于项目根 + 名称的稳定 ID，多次 init 收敛到同一条记录
- 与 Team Server / Obsidian Vault 自动协同：团队成员的 AI 立刻共享你写的项目智慧

**团队知识服务器**
- 中心化 HTTP 服务，所有成员的知识自动汇聚
- 只要安装 MCP，新成员立刻获得团队全部知识
- API Key 认证（timing-safe 比较），支持内网和云部署
- 批量同步接口，支持离线后同步

**多端接入**
- MCP Server：接入 Cursor / OpenCode / Claude Desktop 等任何 MCP 客户端
- CLI：命令行工具覆盖知识管理、扫描、上下文与运维操作
- Repo Scanner：独立的外部采集工具，支持 `ingest git`、`ingest p4`、`hook install`、增量 source 与 daemon
- Web UI：可视化管理知识库（中英文双语，自动跟随系统语言）
- RESTful API：供第三方系统集成

## 快速开始

Mindstrate 有两种使用方式，根据场景选一种：

| 场景 | 怎么部署 | 跳转 |
|------|---------|------|
| **个人本地用** | 一台机器，本地 SQLite，无需服务器 | [个人使用](#个人使用) |
| **团队/服务器部署** | Docker compose 起 Team Server + Web UI；成员 1 行命令装 MCP | [团队部署（Docker）](#团队部署docker) |

### 个人使用

```bash
# 安装
git clone https://github.com/redasm/Mindstrate.git && cd Mindstrate
npm install

# 构建
npx turbo build

# 在你的项目里初始化（自动检测 + 生成项目快照知识）
cd /path/to/your/project
mindstrate init

# 一站式：检测项目 + 生成快照 + 配 MCP + 配 Vault
mindstrate init --tool opencode --with-vault ~/Documents/MyVault
```

> `mindstrate init` 是**幂等**的：再次运行只会更新已变化的部分。它会在项目根创建 `.mindstrate/` 数据目录，并生成一条「项目快照知识」，让 AI 助手在做局部修改时能看到全局心智模型（避免给系统不变量已经保证非空的字段乱加 null check 之类的局部最优错误）。

### 团队部署（Docker）

团队场景下，把 Team Server + Web UI 部署到一台**内网服务器**，所有成员的 MCP 客户端连过来共享知识。**部署形式：独立的 Docker compose 项目**，与服务器上现有的 Docker 服务（飞书机器人等）零冲突。

**架构：**
```
成员 A (Cursor)   成员 B (OpenCode)   成员 C (Claude Desktop)
     │                  │                     │
     │ stdio MCP        │ stdio MCP           │ stdio MCP
     ▼                  ▼                     ▼
┌────────────┐    ┌────────────┐        ┌────────────┐
│MCP 单文件  │    │MCP 单文件   │        │MCP 单文件  │
│(本机 1.2MB)│    │(本机 1.2MB) │        │(本机 1.2MB)│
└────┬───────┘    └────┬───────┘        └────┬───────┘
     │                 │                     │
     └────── HTTP ─────┴─────────────────────┘
                       │
                       ▼
            ┌─────────────────────┐
            │  Team Server :3388  │
            │  Web UI     :3377   │  ← Docker compose
            │  内网服务器          │     与现有 Docker 服务零冲突
            └─────────────────────┘
```

#### 第 1 步：管理员在服务器上部署 Team Server + Web UI

```bash
# 在服务器上
git clone <repo-url> Mindstrate
cd Mindstrate

chmod +x deploy/*.sh
cp deploy/.env.deploy.example deploy/.env.deploy
nano deploy/.env.deploy   # 至少填 TEAM_API_KEY（用 openssl rand -hex 32 生成）

bash deploy/preflight.sh                                          # 部署前自检
docker compose -f deploy/docker-compose.deploy.yml \
               --env-file deploy/.env.deploy \
               up -d --build

curl http://127.0.0.1:3388/health                                 # Team Server
# Web UI 浏览器访问 http://<服务器IP>:3377
```

完整部署手册（含端口冲突处理、备份恢复、升级回滚、与现有 Docker 服务隔离的设计）：[**deploy/README.md**](./deploy/README.md)

#### 第 2 步：管理员把 MCP 安装包推到内网

```bash
# 在你（管理员）的开发机
bash install/build-installer.sh                                   # 产出 install/dist/
rsync -avz install/dist/ user@nginx:/var/www/share/mindstrate/ # 推到内网 Nginx
```

产物是一个 1.2 MB 的单文件 `mindstrate-mcp.js` + manifest + install 脚本。

#### 第 3 步：团队成员一行命令安装

Linux / macOS：
```bash
curl -fsSL http://<nginx>/mindstrate/install.sh \
  | TEAM_SERVER_URL=http://<服务器IP>:3388 \
    TEAM_API_KEY=<同 .env.deploy 里的 key> \
    TOOL=opencode \
    bash
```

Windows PowerShell：
```powershell
$env:TEAM_SERVER_URL = "http://<服务器IP>:3388"
$env:TEAM_API_KEY    = "<同 .env.deploy 里的 key>"
$env:TOOL            = "opencode"
iwr http://<nginx>/mindstrate/install.ps1 -UseBasicParsing | iex
```

成员**不需要 git clone、不需要 npm install、不需要 native 工具链**——只要本机有 Node.js 18+ 即可。安装器会自动写好 OpenCode/Cursor/Claude Desktop 的 MCP 配置。

完整安装文档（管理员发布、成员安装、升级、卸载、FAQ）：[**install/README.md**](./install/README.md)

完成后，成员 A 添加的知识，成员 B 立刻可以搜索到。

## 接入 AI 工具

### Cursor

```json
// .cursor/mcp.json
{
  "mcpServers": {
    "mindstrate": {
      "command": "node",
      "args": ["/path/to/packages/mcp-server/dist/server.js"],
      "env": {
        "MINDSTRATE_DATA_DIR": ".mindstrate"
      }
    }
  }
}
```

### OpenCode

```jsonc
// opencode.json
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "mindstrate": {
      "type": "local",
      "command": ["node", "/path/to/packages/mcp-server/dist/server.js"],
      "environment": {
        "MINDSTRATE_DATA_DIR": ".mindstrate"
      }
    }
  }
}
```

### Claude Desktop

```json
// claude_desktop_config.json
{
  "mcpServers": {
    "mindstrate": {
      "command": "node",
      "args": ["/path/to/packages/mcp-server/dist/server.js"],
      "env": {
        "MINDSTRATE_DATA_DIR": ".mindstrate"
      }
    }
  }
}
```

> 也可以使用 `mindstrate mcp setup` 自动生成配置。

### 自动会话管理

在项目根目录创建 `AGENTS.md`，AI 会自动管理会话生命周期：

```markdown
## 知识管理 (mindstrate MCP)

### 会话生命周期（自动执行）
- **对话开始时**：立即调用 `session_start`，project 设为当前目录名
- **做出关键决策时**：调用 `session_save`，type 为 `decision`
- **解决问题后**：调用 `session_save`，type 为 `problem_solved`
- **对话结束时**：调用 `session_end`，总结本次工作内容

### 知识检索（自动执行）
- 遇到 bug 时，先用 `memory_search` 查询是否已有相关知识
- 新对话开始时，用 `session_restore` 恢复上次的工作上下文
```

## Git / P4 自动采集

> Git / P4 / Hook 数据源采集已经外移到独立工具 `mindstrate-scan`。框架本身只提供知识与事件注入接口；数据源发现、定时扫描、hook 触发都由外部工具负责。`mindstrate-scan` 在本地模式下写本地库，在设置 `TEAM_SERVER_URL` / `TEAM_API_KEY` 时也可以直接写入 Team Server。详见 [packages/repo-scanner/README.md](./packages/repo-scanner/README.md)。

### Git Hook

```bash
# 安装 post-commit 钩子（每次 commit 自动提取知识）
cd /path/to/your/git/project
mindstrate-scan hook install

# 卸载
mindstrate-scan hook uninstall

# 手动扫描最近 N 条提交
mindstrate-scan ingest git --recent 10

# 预览模式
mindstrate-scan ingest git --recent 5 --dry-run
```

### Perforce (P4) Trigger

**方式一：服务端 Trigger（需管理员）**

```bash
p4 triggers
# 添加：
# mindstrate-capture change-commit //depot/... "mindstrate-scan ingest p4 --changelist %changelist%"
```

**方式二：客户端定时扫描（无需服务端权限）**

```bash
# Linux/Mac cron（每 30 分钟扫描最近 5 条提交）
*/30 * * * * mindstrate-scan ingest p4 --recent 5 2>/dev/null
```

```batch
:: Windows 计划任务
schtasks /create /tn "Mindstrate-P4-Scan" /tr "mindstrate-scan ingest p4 --recent 5" /sc minute /mo 30
```

**方式三：P4V 自定义工具**

P4V → Tools → Manage Custom Tools → New Tool，Application 填 `node`，Arguments 填 `mindstrate-scan ingest p4 ...`。

> 设置 `OPENAI_API_KEY` 后使用 LLM 语义分析提取（置信度 0.6-0.9），否则使用规则匹配（置信度 0.4）。自动跳过 merge、WIP、CI、纯格式化等无意义提交。

## Obsidian 双向同步（个人推荐）

把 Mindstrate 知识库镜像成一个 Obsidian Vault，享受 Obsidian 的浏览/编辑体验，同时不放弃语义检索、质量评分、Session Memory 等核心能力。

```bash
# 1. 初始化 Vault 目录
mindstrate vault init ~/Documents/MindstrateVault

# 2. 一次性全量导出
mindstrate vault export ~/Documents/MindstrateVault

# 3. 持续双向同步（按 Ctrl+C 停止）
#    导出后开始监听 Vault：在 Obsidian 编辑会回写 Mindstrate 数据库
mindstrate vault watch ~/Documents/MindstrateVault

# 查看状态
mindstrate vault status ~/Documents/MindstrateVault

# 导出 ECS 高价值规则/技能投影（Rule / Heuristic / Axiom / Skill）
mindstrate projection obsidian ~/Documents/MindstrateVault --project my-project
```

**自动模式**：在 `.env` 设置 `OBSIDIAN_VAULT_PATH=...` 后，MCP Server 启动时会自动把所有新增/更新/删除写入 Vault；要同时监听 Vault 改动，再加 `OBSIDIAN_WATCH=true`。

**ECS 投影导出**：`mindstrate projection obsidian <path>` 只导出 ECS 图中已验证的 `Rule / Heuristic / Axiom / Skill`，适合把稳定规则写成可编辑 Markdown；`mindstrate vault export` 则导出现有 KnowledgeUnit 镜像。

**当前同步策略**：
- `editable`：适合人类维护的知识类型，允许从 Vault 回写到 Mindstrate
- `mirror`：高波动知识类型，只把 Mindstrate 内容镜像到 Vault，不接受 Vault 编辑/删除反向覆盖
- `mindstrate vault status` 会额外输出一份 `canonical-source readiness` 评估，帮助判断 Vault 是否适合升级为更高权限的事实源

**目录布局**：

```
<Vault>/
├── _meta/index.json              ← 同步索引（id ↔ 文件路径）
├── _global/                      ← 没有 project 的知识
│   └── bug-fixes/
├── <项目名>/
│   ├── bug-fixes/<标题>--<id8>.md
│   ├── best-practices/...
│   ├── architecture/...
│   ├── conventions/...
│   ├── patterns/...
│   ├── troubleshooting/...
│   ├── gotchas/...
│   ├── how-to/...
│   └── workflows/...
└── README.md
```

**Markdown 格式**：YAML Frontmatter 存机器元数据（id/type/score/tags/...），正文是人类可读的 `# 标题` + `## Problem/Solution/Code/Steps/...`。Frontmatter 还会写入 `syncMode`（`editable` / `mirror`）和 `bodyHash` 用于冲突检测。`<!-- mindstrate:end -->` 标记下面的内容是私人笔记，不会被同步覆盖。

**冲突处理**：每个文件的 `bodyHash` 用于检测自身回环写入；`awaitWriteFinish` + 500ms 防抖避免编辑器频繁 save 引发风暴；Mindstrate/Vault 双向修改通过文件名内嵌的 `--<id8>` 后缀实现身份恢复，文件改名也能识别；如果 Vault 文件基于旧快照编辑，而 Mindstrate 已有更新内容，watcher 会拒绝这次回写以避免“旧笔记覆盖新知识”。

## Web UI

```bash
# 开发模式
cd packages/web-ui
npm run dev
# 访问 http://localhost:3377

# 生产模式
npm run build && npm run start
```

功能页面：

| 路径 | 功能 |
|------|------|
| `/` | 仪表盘 — 知识总数、类型/状态/语言分布图 |
| `/knowledge` | 知识列表 — 筛选、投票、删除 |
| `/knowledge/new` | 添加知识 |
| `/knowledge/[id]` | 知识详情 — 编辑、投票、元数据 |
| `/search` | 语义搜索 |

支持中英文双语，默认跟随系统语言。可通过 `MINDSTRATE_LOCALE=zh` 或 `en` 强制指定。

## MCP Tools

AI 助手可调用的工具：

| Tool | 说明 |
|------|------|
| `memory_search` | 搜索团队知识库（自动追踪反馈） |
| `memory_add` | 将有价值的解决方案写入知识库（含质量门禁） |
| `memory_feedback` | 对知识投票 |
| `memory_feedback_auto` | 记录知识的自动反馈（采纳/拒绝/忽略） |
| `memory_curate` | 为任务自动组装知识包（上下文策划） |
| `context_assemble` | 组装完整工作上下文（Session + Project Snapshot + Curated Knowledge） |
| `memory_evolve` | 运行知识进化引擎 |
| `session_start` | 开始新会话，自动恢复上次上下文 |
| `session_save` | 保存关键事件（决策、问题解决、决策路径、失败路径等） |
| `session_end` | 结束会话，压缩为摘要 |
| `session_restore` | 获取历史会话上下文 |

## CLI 命令

支持两个可执行名：
- `mindstrate`：正式命令名
- `ms`：短别名，适合日常使用

```
mindstrate init                    初始化（幂等；生成项目快照 + 元数据）
mindstrate add [options]           添加知识
mindstrate search <query>          语义搜索
mindstrate list [options]          列出知识
mindstrate stats                   统计信息
mindstrate vote <id> <up|down>     投票
mindstrate delete <id>             删除
mindstrate export [file]           导出知识库
mindstrate import <file>           导入知识
mindstrate mcp setup [options]     生成 MCP 配置
mindstrate web [options]           启动 Web UI
mindstrate doctor                  质量维护
mindstrate evolve [options]        运行知识进化引擎（支持 --mode background）
mindstrate eval [options]          运行检索质量评估
mindstrate ctx <task>              上下文策划
mindstrate vault init <path>       初始化 Obsidian vault 同步目录
mindstrate vault export [path]     全量导出 Mindstrate 知识到 vault（一次性）
mindstrate vault watch [path]      持续双向同步：导出 + 监听 vault 改动
mindstrate vault status [path]     查看 vault 同步状态 + canonical-source readiness
mindstrate projection knowledge    生成 KnowledgeUnit 投影记录
mindstrate projection sessions     生成会话摘要投影记录
mindstrate projection project-snapshots 生成项目快照投影记录
mindstrate projection obsidian <path>   导出 ECS 稳定规则/技能到 Markdown
```

示例：

```bash
ms add --title "Fix hydration mismatch" --solution "Move browser-only logic into useEffect"
ms eval
ms mcp setup --tool cursor
```

外部数据源工具：

```bash
mindstrate-scan ingest git --last-commit
mindstrate-scan ingest p4 --recent 10
mindstrate-scan hook install
mindstrate-scan source add-git --name my-repo --project my-project --repo-path /path/to/repo
mindstrate-scan daemon
```

团队模式下也可以直接注入到 Team Server：

```bash
TEAM_SERVER_URL=http://your-server:3388 \
TEAM_API_KEY=your-team-secret \
mindstrate-scan ingest git --last-commit --project my-project
```

> 如果你不想安装全局命令，可以在任意命令前加上 `node packages/cli/dist/index.js`。

## 项目结构

```
Mindstrate/
├── packages/
│   ├── protocol/              # 协议层 — 类型/枚举/错误，零运行时依赖
│   │   └── src/
│   │       ├── models/        # KnowledgeUnit / Session / Retrieval / Feedback
│   │       ├── errors.ts      # 错误类层级
│   │       └── results.ts     # PipelineResult / EvolutionRunResult 等线上契约
│   ├── client/                # HTTP 客户端 — 纯 fetch，零 native 依赖
│   │   └── src/team-client.ts # 给 mcp-server 等 HTTP 消费者用
│   ├── server/                # 服务端运行时 — SQLite/OpenAI/检索/进化/采集
│   │   └── src/
│   │       ├── capture/       # 提取器（把变更转换为知识），不负责数据源采集
│   │       ├── processing/    # 处理流水线（去重、标准化、Embedding）
│   │       ├── storage/       # 存储层（SQLite + JSON 向量索引）
│   │       ├── retrieval/     # 检索层（混合检索 + 上下文策划）
│   │       ├── quality/       # 质量管理（评分、反馈闭环、进化、评估）
│   │       ├── project/       # 项目检测 + 快照生成
│   │       └── server facade 主入口
│   ├── mcp-server/            # MCP Server，esbuild 单文件 bundle (~1.2 MB)
│   │   └── src/
│   │       ├── tools/         # MCP 工具定义、Schema 验证、处理函数
│   │       └── resources/     # MCP 资源处理
│   ├── team-server/           # 团队知识服务器（Express HTTP + timing-safe 认证）
│   ├── cli/                   # 命令行工具（支持 `mindstrate` / `ms`）
│   ├── obsidian-sync/         # Obsidian Vault 双向同步（个人推荐）
│   ├── repo-scanner/          # 外部采集工具（git / p4 / hook / daemon / retry）
│   └── web-ui/                # Web 管理界面（Next.js 15 + 中英文国际化）
├── deploy/                    # Docker 部署：team-server + web-ui compose
│   ├── docker-compose.deploy.yml
│   ├── team-server.Dockerfile
│   ├── web-ui.Dockerfile
│   ├── preflight.sh           # 部署前自检（端口/资源/冲突）
│   ├── backup.sh / restore.sh # 数据卷备份恢复
│   └── README.md              # 完整部署运维手册
├── install/                   # 团队成员一键安装包
│   ├── build-installer.sh     # 管理员用，打 bundle + manifest
│   ├── install.sh / install.ps1
│   └── README.md              # 管理员发布、成员安装指南
├── docs/architecture.md       # 4 层包架构与 ESLint 防御规则
├── eslint.config.mjs          # 强制层级边界，防止反向依赖
├── AGENTS.md                  # AI 助手自动行为规则
└── .env.example
```

> **架构边界**：`protocol → client → mcp-server` 与 `protocol → server → (cli/team-server/web-ui/obsidian-sync)` 两条链路。
> mcp-server 默认只依赖 `protocol + client`，不接触 SQLite — 这是 1.2 MB 单文件分发能跑在任何 Node 18+ 机器上的根本原因。
> 完整说明见 [`docs/architecture.md`](./docs/architecture.md)。

## 技术栈

| 层 | 技术 |
|----|------|
| 语言 | TypeScript (Node.js) |
| Monorepo | npm workspaces + Turborepo |
| 元数据库 | SQLite (better-sqlite3, WAL mode) |
| 向量存储 | 本地 JSON 向量索引（余弦相似度 + 维度校验） |
| Embedding | OpenAI text-embedding-3-small / 离线 hash-based |
| MCP | @modelcontextprotocol/sdk |
| Team Server | Express.js + CORS + timing-safe API Key 认证 |
| CLI | Commander.js |
| Web UI | Next.js 15 + React 19 + Tailwind CSS + 中英文 i18n |
| 质量管理 | 自动反馈闭环 + 知识进化引擎 + 检索评估系统 |
| 测试 | Vitest (201 单元测试) |

## 环境变量

| 变量 | 说明 | 默认值 |
|------|------|--------|
| `OPENAI_API_KEY` | LLM 服务商 API Key（可选） | 无（离线 hash 模式） |
| `OPENAI_BASE_URL` | LLM 服务商 base URL，**支持任何 OpenAI 兼容接口**（阿里云/DeepSeek/Moonshot/本地 Ollama 等） | OpenAI 官方 |
| `OPENAI_EMBEDDING_BASE_URL` | Embedding 服务的独立 base URL（混合厂商场景） | 同 `OPENAI_BASE_URL` |
| `MINDSTRATE_EMBEDDING_MODEL` | Embedding 模型名 | `text-embedding-3-small` |
| `MINDSTRATE_LLM_MODEL` | Chat / 抽取 / 进化用的模型名 | `gpt-4o-mini` |
| `MINDSTRATE_DATA_DIR` | 数据存储目录 | `~/.mindstrate` |
| `MINDSTRATE_LOCALE` | Web UI 语言（`zh` / `en`） | 自动检测系统语言 |
| `TEAM_SERVER_URL` | Team Server 地址（设置后启用团队模式） | 无（本地模式） |
| `TEAM_API_KEY` | Team Server API Key | 无 |
| `TEAM_PORT` | Team Server 监听端口 | `3388` |
| `LOG_LEVEL` | MCP Server 日志级别 | `info` |
| `OBSIDIAN_VAULT_PATH` | Obsidian Vault 路径（设置后自动启用同步） | 无 |
| `OBSIDIAN_AUTO_SYNC` | 写入 Mindstrate 时是否自动镜像到 Vault | `true` |
| `OBSIDIAN_WATCH` | MCP Server 启动时同时监听 Vault 文件变化 | `false` |

### LLM 服务商配置示例

Mindstrate 默认走 OpenAI 官方 API，但**任何兼容 OpenAI HTTP 接口的厂商都能直接接入**——只要设置 `OPENAI_BASE_URL`。

**阿里云通义千问**（推荐国内场景）：
```bash
OPENAI_API_KEY=sk-aliyun-xxxxx
OPENAI_BASE_URL=https://dashscope.aliyuncs.com/compatible-mode/v1
MINDSTRATE_LLM_MODEL=qwen-max
MINDSTRATE_EMBEDDING_MODEL=text-embedding-v3
```

**DeepSeek**（性价比高，代码能力强）：
```bash
OPENAI_API_KEY=sk-deepseek-xxxxx
OPENAI_BASE_URL=https://api.deepseek.com/v1
MINDSTRATE_LLM_MODEL=deepseek-chat
# DeepSeek 暂无 embedding 模型，留空 OPENAI_EMBEDDING_BASE_URL 即可让 embedding 走默认（OpenAI），
# 或者不设 API key 让 embedding 走本地 hash 模式
```

**Moonshot 月之暗面**（128K 长上下文）：
```bash
OPENAI_API_KEY=sk-moonshot-xxxxx
OPENAI_BASE_URL=https://api.moonshot.cn/v1
MINDSTRATE_LLM_MODEL=moonshot-v1-32k
```

**本地 Ollama**（完全离线，零成本）：
```bash
OPENAI_API_KEY=ollama                            # 任意非空占位字符串即可
OPENAI_BASE_URL=http://127.0.0.1:11434/v1
MINDSTRATE_LLM_MODEL=qwen2.5
```

**混合模式**（阿里云做 Chat、OpenAI 做 Embedding）：
```bash
OPENAI_API_KEY=sk-aliyun-xxxxx
OPENAI_BASE_URL=https://dashscope.aliyuncs.com/compatible-mode/v1
MINDSTRATE_LLM_MODEL=qwen-max
OPENAI_EMBEDDING_BASE_URL=https://api.openai.com/v1
MINDSTRATE_EMBEDDING_MODEL=text-embedding-3-small
# 注意：embedding 走 OpenAI 时也要确认 OPENAI_API_KEY 对 OpenAI 有效，
# 或在调用方分别配置（这是当前的简化模型，如需完全分离的 key 可提 issue）
```

完整列表见 [.env.example](.env.example)，详细说明见 [部署指南](docs/deployment-guide.md)。

## License

Apache-2.0
