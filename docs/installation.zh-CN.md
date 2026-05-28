# 安装指南

本文覆盖 Mindstrate 的三种常见安装路径：

- 个人本地模式；
- 团队成员客户端；
- Team Server 部署。

同时说明 MCP 配置、LLM 服务商配置，以及哪些文件应该提交到仓库。

## 环境要求

| 组件 | 要求 |
| --- | --- |
| Node.js | 20.19 或更新（Node 18 已于 2025-04 EOL，不再纳入测试） |
| npm | 10 或更新 |
| Git | 源码安装和 Git 采集需要 |
| Docker | 仅 Team Server Docker 部署需要 |
| p4 CLI | 可选，仅 Perforce 采集需要 |
| OpenAI 兼容 API | 可选；不配置时仍可用离线 hash embedding 和确定性提取。团队模式下按项目在 Web UI 中配置 |

## 从源码构建

```bash
git clone https://github.com/redasm/Mindstrate.git
cd Mindstrate
npm install
npx turbo build
```

开发环境可以把 CLI 链接为全局命令：

```bash
npm link
mindstrate --help
```

如果 `mindstrate` 不在 `PATH` 中，可以直接调用构建后的入口：

```bash
node /path/to/Mindstrate/packages/cli/dist/index.js --help
```

Windows 示例：

```powershell
node C:\AppProject\Mindstrate\packages\cli\dist\index.js --help
```

## 个人本地安装

适合单人使用。数据写在当前项目 `.mindstrate/`，可选同步到 Obsidian。

```bash
cd /path/to/your/project
mindstrate setup --mode local
```

向导会完成：

- 检测项目；
- 写入 `.mindstrate/config.json`；
- 初始化 `.mindstrate/` 本地数据目录；
- 生成项目快照；
- 建立项目图谱；
- 可选导出项目图谱到 Obsidian vault；
- 为 Cursor、OpenCode、Claude Desktop 或全部工具写入 MCP 配置。

非交互式本地安装：

```bash
mindstrate setup --mode local --tool opencode --yes
```

连接 Obsidian：

```bash
mindstrate setup \
  --mode local \
  --tool cursor \
  --vault ~/Documents/MindstrateVault
```

安装后可以检查：

```bash
mindstrate graph status
mindstrate graph query "entry point"
```

## Team Server 部署

团队模式建议把 Team Server 和 Web UI 部署在内网服务器上，成员本地 MCP 通过 HTTP 连接它。

### 1. 生成部署配置

在 Mindstrate 仓库根目录运行：

```bash
mindstrate setup --mode team-deploy
```

向导会写入 `deploy/.env.deploy`。至少需要：

```env
TEAM_API_KEY=<long-random-secret>
TEAM_PORT=3388
WEB_UI_PORT=3377
```

生成密钥：

```bash
openssl rand -hex 32
```

### 2. 启动 Team Server 和 Web UI

```bash
bash deploy/preflight.sh
docker compose -f deploy/docker-compose.deploy.yml \
  --env-file deploy/.env.deploy \
  up -d --build
```

检查服务：

```bash
curl http://127.0.0.1:3388/health
# Web UI: http://<server>:3377
```

### 3. Web 控制台

部署完成后，所有团队运维都在 Web UI 完成。打开 `http://<server>:3377/login`，使用 `.env.deploy` 中的 `TEAM_API_KEY` 登录（这是 **唯一** 的管理员引导密钥，不要随成员分发；成员密钥在登录后于 Settings → Users 中签发）。

![Web UI 登录](images/login.jpg)

登录后会进入 Settings 总览：

![Settings 总览](images/setting_overview.jpg)

按顺序完成以下首次配置：

1. **Settings → Users**：为每位成员创建一条 API Key，可指定 `admin/member` 角色以及该 Key 允许访问的项目集合（`*` 表示所有项目）。把生成的 Key 通过安全渠道发给成员，作为 `TEAM_API_KEY` 注入到该成员的 MCP 配置中。

   ![Users 与 API Key](images/setting_user.jpg)

2. **Settings → Scanner Sources**：按项目添加 Git/P4 扫描源（仓库路径、远端 URL、Auth token、轮询间隔、初始模式等）。Daemon 会读取这里的配置自动采集，不再依赖以前的 `MINDSTRATE_SCANNER_*` 环境变量。

3. **Settings → LLM Configs**：按项目配置 OpenAI 兼容 provider（API Key、Base URL、LLM 模型、Embedding 模型、Embedding 维度）。未配置的项目会回退到 256 维离线哈希向量并跳过 LLM 抽取。详见 [LLM 服务商配置](#llm-服务商配置)。

成员视角的浏览能力（知识、项目图谱、全局搜索）见 [Web 控制台 — 成员视角](#web-控制台--成员视角)。

### 部署文件

```text
deploy/
├── docker-compose.deploy.yml
├── .env.deploy.example
├── team-server.Dockerfile
├── web-ui.Dockerfile
├── preflight.sh
├── export-data-volume.sh
└── restore.sh
```

Docker 部署使用独立 compose project、独立 network 和独立 volume，不会接触服务器上已有的容器、网络或 volume。Team Server 和 Web UI 必须共享同一个 SQLite 数据目录，不要把两个容器指向不同 volume。

### 日常运维

```bash
docker compose -f deploy/docker-compose.deploy.yml --env-file deploy/.env.deploy logs -f
docker compose -f deploy/docker-compose.deploy.yml --env-file deploy/.env.deploy restart
docker compose -f deploy/docker-compose.deploy.yml --env-file deploy/.env.deploy up -d --build
docker compose -f deploy/docker-compose.deploy.yml --env-file deploy/.env.deploy down
```

### 备份与恢复

```bash
bash deploy/export-data-volume.sh
EXPORT_DIR=/srv/mindstrate-data-exports bash deploy/export-data-volume.sh

docker compose -f deploy/docker-compose.deploy.yml --env-file deploy/.env.deploy stop
bash deploy/restore.sh ./data-exports/mindstrate-20260420-101500.tgz
docker compose -f deploy/docker-compose.deploy.yml --env-file deploy/.env.deploy up -d
```

定期备份可以放到 cron：

```cron
0 3 * * * cd /opt/Mindstrate && EXPORT_DIR=/srv/mindstrate-data-exports bash deploy/export-data-volume.sh >> /var/log/mindstrate-data-export.log 2>&1
```

### 端口和访问范围

如果 `preflight.sh` 报端口占用，修改 `deploy/.env.deploy`：

```env
TEAM_PORT=4388
WEB_UI_PORT=4377
```

如果只允许本机反向代理访问：

```env
TEAM_BIND=127.0.0.1
WEB_UI_BIND=127.0.0.1
```

> LLM provider、扫描源和成员 API Key 不再通过环境变量配置，全部在 Web UI 中按项目治理。仓库根目录的 `.env.deploy` 只保留端口、绑定地址、`TEAM_API_KEY`（管理员引导密钥）、日志级别和 Locale。

### 部署故障排查

| 现象 | 处理 |
| --- | --- |
| `TEAM_API_KEY must be set` | 检查 `deploy/.env.deploy`，并确认 compose 命令传入了 `--env-file` |
| Web UI 显示空 | 检查 Team Server 和 Web UI 是否挂载同一个数据 volume |
| 客户端 401 Unauthorized | 确认客户端 `TEAM_API_KEY` 与服务端一致 |
| Healthcheck 一直 unhealthy | 查看 `docker logs mindstrate-team-server` |
| 升级后 Web UI 报 502 | 等待 Next.js 启动，或查看 `docker compose ... logs web-ui` |

## 团队成员接入

> 接入前，管理员需要先在 Web UI `Settings → Users` 中为该成员签发一条 API Key（建议使用 `member` 角色，并把 projects 限定到他需要访问的项目集合）。下文中的 `<key>` 指这条 **成员密钥**，而不是 `.env.deploy` 中的管理员引导密钥 `TEAM_API_KEY`。

每个成员在自己的项目中运行：

```bash
cd /path/to/your/project
mindstrate setup \
  --mode team \
  --tool cursor \
  --team-server-url http://<server>:3388 \
  --team-api-key <key>
```

向导会把 MCP 配置写入对应 AI 工具，并注入：

```env
TEAM_SERVER_URL=http://<server>:3388
TEAM_API_KEY=<key>
```

设置 `TEAM_SERVER_URL` 后，MCP server 进入团队模式，不再使用本地 SQLite 作为事实源，而是把读写转发到 Team Server。成员只能访问其密钥被授权的项目，跨项目读写会被服务器以 403 拒绝。

## 团队成员安装包

如果不希望成员 clone 仓库，管理员可以构建单文件 MCP 安装包：

```bash
bash install/build-installer.sh
```

构建产物：

```text
install/dist/
  mindstrate-mcp.js
  install.sh
  install.ps1
  manifest.json
```

发布前，把 `install/install.sh` 和 `install/install.ps1` 里的下载地址改成团队内网 HTTP 地址，例如：

```text
http://internal.company.com/mindstrate
```

然后发布并验证：

```bash
bash install/build-installer.sh
rsync -avz install/dist/ user@nginx:/var/www/share/mindstrate/
curl http://internal.company.com/mindstrate/manifest.json
```

成员一行安装：

Linux / macOS：

```bash
curl -fsSL http://<host>/mindstrate/install.sh \
  | TEAM_SERVER_URL=http://<server>:3388 \
    TEAM_API_KEY=<key> \
    TOOL=opencode \
    bash
```

Windows PowerShell：

```powershell
$env:TEAM_SERVER_URL = "http://<server>:3388"
$env:TEAM_API_KEY = "<key>"
$env:TOOL = "opencode"
iwr http://<host>/mindstrate/install.ps1 -UseBasicParsing | iex
```

默认安装位置：

| OS | 路径 |
| --- | --- |
| Linux / macOS | `~/.mindstrate-mcp/mindstrate-mcp.js` |
| Windows | `%USERPROFILE%\\.mindstrate-mcp\\mindstrate-mcp.js` |

安装器会合并 MCP 配置中的 `mindstrate` 项，不会覆盖整个配置文件。

验证安装：

```bash
TEAM_SERVER_URL=http://<server>:3388 \
TEAM_API_KEY=<key> \
node ~/.mindstrate-mcp/mindstrate-mcp.js
```

升级方式是重新运行安装脚本。安装器会拉取最新 `manifest.json`、下载 `mindstrate-mcp.js`、校验 SHA256，并保留现有 MCP 配置。

卸载时删除本地安装目录，然后从 AI 工具的 MCP 配置中移除 `mindstrate`：

```bash
rm -rf ~/.mindstrate-mcp
```

Windows：

```powershell
Remove-Item -Recurse $env:USERPROFILE\.mindstrate-mcp
```

安装包只负责安装单文件 MCP 并连接 Team Server；Git、Perforce、hook、daemon 和自定义采集器由 `packages/repo-scanner` 提供。

常见问题：

| 现象 | 处理 |
| --- | --- |
| `Cannot fetch manifest.json` | 检查内网 HTTP 地址、文件是否上传、成员机器是否可访问 |
| `401 Unauthorized` | 检查 `TEAM_API_KEY` |
| `Team Server is not reachable` | 检查 `TEAM_SERVER_URL`、VPN、服务器状态和端口 |
| 安装成功但 AI 工具里看不到工具 | 重启 AI 工具，确认配置写入了正确位置 |

## MCP 配置

推荐使用命令生成：

```bash
mindstrate mcp setup --tool cursor
mindstrate mcp setup --tool opencode
mindstrate mcp setup --tool claude-desktop --global
```

Cursor 项目级配置示例：

```json
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

团队模式额外加入：

```json
{
  "TEAM_SERVER_URL": "http://<server>:3388",
  "TEAM_API_KEY": "<key>"
}
```

### 告诉 AI 何时使用 Mindstrate MCP

MCP 配置只让工具可用，不一定会让 AI 主动使用它。建议在每个接入 Mindstrate 的项目根目录创建或更新 `AGENTS.md`，加入项目级使用规则。OpenCode、Cursor、Claude Code 等工具会读取类似的 agent instruction 文件时，可以据此决定何时查询或写入 Mindstrate。

示例：

```md
# Agent Memory Rules

- Before planning non-trivial code changes, query Mindstrate for relevant project knowledge, project graph facts, prior decisions, and known risks.
- Use Mindstrate MCP to assemble task context when the task touches unfamiliar code, architecture boundaries, tests, deployment, or previous incidents.
- Query the project graph before editing files to understand ownership, dependencies, call chains, generated code, and blast radius.
- After fixing a bug, discovering a project convention, resolving a confusing setup issue, or learning a reusable workflow, write a concise memory entry to Mindstrate with evidence paths.
- Do not store secrets, API keys, credentials, personal data, or large raw logs in Mindstrate memory.
- Treat Mindstrate results as evidence-backed context, not as permission to skip reading source files or running tests.
```

如果项目已有 `AGENTS.md`，把上面的规则追加到现有文件即可；不要覆盖团队已有的代码风格、测试和安全规则。

## LLM 服务商配置

Mindstrate 不强制依赖 LLM。**未配置 LLM provider 的项目** 会使用确定性提取和 256 维本地 hash embedding，仍可用但语义检索质量较弱、知识进化也会跳过 LLM 抽取。

团队模式下，LLM/Embedding provider 在 Web UI 中按项目配置，不再使用进程级环境变量。打开 `Settings → LLM Configs → + 新增配置`，按字段填写：

| 字段 | 说明 |
| --- | --- |
| Project | 该配置作用的项目名（同一项目只能存在一条配置）。 |
| OpenAI API Key | 以明文存入共享 SQLite，与扫描源凭据同等级别。 |
| LLM Base URL | 可选；留空使用 OpenAI 官方端点。 |
| Embedding Base URL | 可选；留空与 LLM Base URL 共用同一端点。 |
| LLM Model | `gpt-4o-mini`、`qwen-max`、`deepseek-chat` 等。 |
| Embedding Model | `text-embedding-3-small`、`text-embedding-v3`、`bge-m3` 等。常见模型会自动填充维度。 |
| Embedding Dim | 必须与模型实际输出一致；不同项目可以使用不同维度，向量会写入各自的独立集合。 |

常见 OpenAI 兼容 Base URL：

```text
OpenAI 官方:        https://api.openai.com/v1
阿里云 DashScope:   https://dashscope.aliyuncs.com/compatible-mode/v1
DeepSeek:           https://api.deepseek.com/v1
Moonshot:           https://api.moonshot.cn/v1
本地 Ollama:        http://127.0.0.1:11434/v1
```

修改配置后 provider 缓存会失效，下一次写入或搜索会立即使用新模型；删除配置后该项目自动回退到离线模式。

> 个人本地模式（未连接 Team Server）仍支持把 `OPENAI_API_KEY` 通过 MCP 配置注入到本地 MCP 进程；但 Team Server 上的 LLM 配置只通过 Web UI 管理。

## Web 控制台 — 成员视角

成员使用自己的 API Key 登录 Web UI 后，可以在浏览器中：

- 浏览该项目的知识条目、了解 ECS 代谢谱系（episode → snapshot → pattern → rule）：

  ![知识浏览](images/knowledge.jpg)

- 浏览项目图谱节点、依赖关系、影响面和编辑前安全提示，并把人工备注作为 overlay 写回图谱：

  ![项目图谱](images/project_graph.jpg)

- 触发跨项目的全局搜索，定位知识、项目快照或图谱节点：

  ![全局搜索](images/golbal_search.jpg)


## Git 提交建议

建议提交：

- `.mindstrate/project.json`
- `.mindstrate/config.json`，前提是不含密钥且团队希望共享默认配置
- `.mindstrate/rules/*.json`
- 仓库入口投影，例如 `PROJECT_GRAPH.md`

不要提交：

- `.mindstrate/mindstrate.db*`
- `.mindstrate/vectors/`
- Team API Key
- 本地 Obsidian vault 内容，除非团队明确把它作为仓库内容管理

`mindstrate init` 会创建 `.mindstrate/.gitignore`，默认忽略本地 DB 和向量文件，同时允许提交 `project.json`。
