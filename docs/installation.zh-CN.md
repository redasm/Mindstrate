# 安装指南

本文覆盖 Mindstrate 的三种常见安装路径：

- 个人本地模式；
- 团队成员客户端；
- Team Server 部署。

同时说明 MCP 配置、LLM 服务商配置，以及哪些文件应该提交到仓库。

## 环境要求

| 组件 | 要求 |
| --- | --- |
| Node.js | 18 或更新 |
| npm | 10 或更新 |
| Git | 源码安装和 Git 采集需要 |
| Docker | 仅 Team Server Docker 部署需要 |
| p4 CLI | 可选，仅 Perforce 采集需要 |
| OpenAI 兼容 API | 可选；不配置时仍可用离线 hash embedding 和确定性提取 |

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

### 端口、访问范围和 OpenAI

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

不设置 `OPENAI_API_KEY` 时，服务使用离线 hash embedding 和确定性提取；设置后会启用 OpenAI 兼容 embedding 和 LLM 抽取能力。

### 部署故障排查

| 现象 | 处理 |
| --- | --- |
| `TEAM_API_KEY must be set` | 检查 `deploy/.env.deploy`，并确认 compose 命令传入了 `--env-file` |
| Web UI 显示空 | 检查 Team Server 和 Web UI 是否挂载同一个数据 volume |
| 客户端 401 Unauthorized | 确认客户端 `TEAM_API_KEY` 与服务端一致 |
| Healthcheck 一直 unhealthy | 查看 `docker logs mindstrate-team-server` |
| 升级后 Web UI 报 502 | 等待 Next.js 启动，或查看 `docker compose ... logs web-ui` |

## 团队成员接入

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

设置 `TEAM_SERVER_URL` 后，MCP server 进入团队模式，不再使用本地 SQLite 作为事实源，而是把读写转发到 Team Server。

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

## LLM 服务商配置

Mindstrate 不强制依赖 LLM。不设置 `OPENAI_API_KEY` 时，会使用确定性提取和本地 hash embedding。

如果需要更好的语义检索、提交提取、图谱 enrichment 和知识进化，可以配置 OpenAI 兼容服务：

```bash
mindstrate setup \
  --openai-api-key sk-... \
  --openai-base-url https://api.openai.com/v1 \
  --llm-model gpt-4o-mini \
  --embedding-model text-embedding-3-small
```

常见兼容服务：

```bash
# 阿里云 DashScope compatible mode
OPENAI_BASE_URL=https://dashscope.aliyuncs.com/compatible-mode/v1
MINDSTRATE_LLM_MODEL=qwen-max
MINDSTRATE_EMBEDDING_MODEL=text-embedding-v3

# Moonshot
OPENAI_BASE_URL=https://api.moonshot.cn/v1
MINDSTRATE_LLM_MODEL=moonshot-v1-32k

# 本地 Ollama 兼容端点
OPENAI_API_KEY=ollama
OPENAI_BASE_URL=http://127.0.0.1:11434/v1
MINDSTRATE_LLM_MODEL=qwen2.5
```

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
