# 部署指南

本文说明 Mindstrate 支持的部署模式和运维配置。

## 环境要求

| 项目 | 要求 |
| --- | --- |
| Node.js | 20.19 或更高版本（Node 18 已于 2025-04 EOL，不再纳入测试） |
| npm | 10 或更高版本 |
| 操作系统 | Windows、macOS 或 Linux |
| Git | 可选，用于 Git 采集工作流 |
| Perforce CLI | 可选，用于 P4 采集工作流 |
| LLM provider key | 可选；不再通过环境变量传入，由 Web UI 按项目配置 |

## 从源码构建

```bash
git clone https://github.com/redasm/Mindstrate.git
cd Mindstrate
npm install
npx turbo build
npm link
```

验证 CLI：

```bash
mindstrate --help
```

## Docker 构建与部署

仓库在 `deploy/` 下提供按服务拆分的多阶段 Dockerfile，统一以仓库根作为构建上下文，并依赖 Turborepo 只构建目标服务的依赖链。

| 服务 | Dockerfile | 入口 | 容器端口 |
| --- | --- | --- | --- |
| team-server | `deploy/team-server.Dockerfile` | `team-server/dist/server.js` | 3388 |
| web-ui | `deploy/web-ui.Dockerfile` | Next.js standalone `web-ui/server.js` | 3377 |
| repo-scanner | `deploy/repo-scanner.Dockerfile` | `repo-scanner/dist/cli.js daemon` | — |

三个服务共享同一个命名卷 `mindstrate-data:/data`（同一份 SQLite），web-ui 直接读写该数据库而不经过 team-server HTTP。

### 准备配置

```bash
cp deploy/.env.deploy.example deploy/.env.deploy
# 编辑 deploy/.env.deploy：至少设置 TEAM_API_KEY（可用 openssl rand -hex 32 生成），按需调整端口
```

### 用 Compose 构建并启动

构建并启动核心服务（team-server + web-ui）：

```bash
docker compose -f deploy/docker-compose.deploy.yml --env-file deploy/.env.deploy up -d --build
```

包含 repo-scanner daemon（位于 `scanner` profile，默认不随核心服务启动）：

```bash
docker compose -f deploy/docker-compose.deploy.yml --env-file deploy/.env.deploy --profile scanner up -d --build
```

> repo-scanner 不在 `scanner` profile 下启动时不会执行任何扫描，已配置的扫描源会一直停在“等待运行”状态。

### 强制不使用缓存重建

`docker compose up` 不直接支持 `--no-cache`，需要先 `build --no-cache` 再 `up`：

```bash
docker compose -f deploy/docker-compose.deploy.yml --env-file deploy/.env.deploy build --no-cache
docker compose -f deploy/docker-compose.deploy.yml --env-file deploy/.env.deploy up -d
```

包含 repo-scanner：

```bash
docker compose -f deploy/docker-compose.deploy.yml --env-file deploy/.env.deploy --profile scanner build --no-cache
docker compose -f deploy/docker-compose.deploy.yml --env-file deploy/.env.deploy --profile scanner up -d
```

P4 扫描需要内置 Helix CLI 时（镜像约增加 50 MB），传入 `INSTALL_P4=1` 构建参数：

```bash
INSTALL_P4=1 docker compose -f deploy/docker-compose.deploy.yml --env-file deploy/.env.deploy --profile scanner build --no-cache
docker compose -f deploy/docker-compose.deploy.yml --env-file deploy/.env.deploy --profile scanner up -d
```

### 单镜像手工构建

构建上下文必须是仓库根 `.`：

```bash
docker build -f deploy/team-server.Dockerfile  -t mindstrate/team-server:latest  .
docker build -f deploy/web-ui.Dockerfile       -t mindstrate/web-ui:latest       .
docker build -f deploy/repo-scanner.Dockerfile -t mindstrate/repo-scanner:latest --build-arg INSTALL_P4=1 .
```

加 `--no-cache` 即可忽略所有层缓存重新构建：

```bash
docker build --no-cache -f deploy/team-server.Dockerfile -t mindstrate/team-server:latest .
```

### 验证

```bash
curl http://127.0.0.1:3388/health
```

浏览器打开 `http://<host>:3377`。

## 本地模式

本地模式把项目数据存放在当前项目 `.mindstrate/` 目录，可选输出 Obsidian 投影。

Mindstrate 支持两种部署模式：

```text
+-------------------------------------------------------------+
| 本地模式                         团队模式                   |
|                                                             |
| 成员 A                          成员 A    成员 B    成员 C  |
|   |                              |         |         |       |
|   v                              v         v         v       |
| +--------+                    +-----+   +-----+   +-----+   |
| | MCP    |                    | MCP |   | MCP |   | MCP |   |
| | Server |                    +-----+   +-----+   +-----+   |
| +--------+                       |         |         |       |
|   |                              +---------+---------+       |
|   v                                        |                 |
| +--------+                                 v                 |
| | 本地   |                           +-------------+         |
| | SQLite |                           | Team Server |         |
| +--------+                           | :3388       |         |
|                                      +-------------+         |
| 数据在本地                         数据集中存储、实时共享   |
| 适合个人使用                       适合团队使用             |
+-------------------------------------------------------------+
```

```bash
cd /path/to/project
mindstrate setup --mode local --tool opencode --yes
mindstrate init
```

本地模式适合个人工作流、本地项目图谱分析和单用户 Obsidian 输出。

## 团队模式

团队模式使用共享 Team Server。团队成员运行本地 MCP Server，通过 HTTP 把请求转发到 Team Server。

典型 Team Server 环境变量：

```bash
TEAM_PORT=3388
TEAM_API_KEY=your-team-secret     # 管理员引导密钥；成员密钥由 Web UI 签发
MINDSTRATE_DATA_DIR=/data/mindstrate
```

> LLM provider、扫描源、成员 API Key 都在 Web UI 中按项目治理，不再通过环境变量传入。`OPENAI_API_KEY` / `OPENAI_BASE_URL` / `MINDSTRATE_LLM_MODEL` / `MINDSTRATE_EMBEDDING_MODEL` 等历史变量已经被移除。

构建后启动服务：

```bash
node packages/team-server/dist/server.js
```

健康检查：

```bash
curl http://localhost:3388/health
```

团队成员接入：

```bash
mindstrate setup \
  --mode team \
  --tool cursor \
  --team-server-url http://team-server:3388 \
  --team-api-key your-team-secret
```

## MCP 配置

`mindstrate setup` 或 `mindstrate mcp setup` 会为支持的工具写入 MCP 配置。密钥应放在环境变量或工具 MCP 配置中，不应写入会提交到仓库的项目配置。

常见工具：

- Cursor：`.cursor/mcp.json`
- OpenCode：`opencode.json`
- Claude Desktop：全局桌面配置

建议同时在项目根目录的 `AGENTS.md` 中追加 Mindstrate MCP 使用规则，告诉 AI 在规划复杂修改、查询项目图谱、恢复上下文和沉淀可复用经验时主动调用 Mindstrate。完整模板见 [安装指南](installation.zh-CN.md#告诉-ai-何时使用-mindstrate-mcp)。

## 环境变量

| 变量 | 用途 |
| --- | --- |
| `MINDSTRATE_DATA_DIR` | 本地或 Team Server 数据目录 |
| `MINDSTRATE_DB_PATH` | 显式 SQLite 数据库路径 |
| `MINDSTRATE_VECTOR_BACKEND` | `local`（默认）或 `qdrant` |
| `MINDSTRATE_QDRANT_URL` | 使用 `qdrant` 后端时的 Qdrant 服务地址 |
| `MINDSTRATE_LOCALE` | 输出语言偏好，例如 `en` 或 `zh-CN` |
| `TEAM_PORT` | Team Server 端口 |
| `TEAM_API_KEY` | Team Server 管理员引导密钥（成员密钥在 Web UI 中签发） |
| `TEAM_SERVER_URL` | 客户端/MCP 使用的 Team Server URL |
| `LOG_LEVEL` | 日志级别 |

可从 `.env.example` 和 `deploy/.env.deploy.example` 复制模板。

> **已移除的环境变量**：`OPENAI_API_KEY`、`OPENAI_BASE_URL`、`OPENAI_EMBEDDING_BASE_URL`、`MINDSTRATE_LLM_MODEL`、`MINDSTRATE_EMBEDDING_MODEL`、`MINDSTRATE_SCANNER_*`。这些设置现在在 Web UI `Settings → LLM Configs` 和 `Settings → Scanner Sources` 中按项目维护。

## 运维建议

生产环境建议：

- 将 Team Server 放在内网控制或反向代理之后。
- 生产环境设置 `TEAM_API_KEY`（仅作为管理员引导，不要分发给成员）。
- 通过 Web UI `Settings → Users` 为每位成员单独签发受限项目的 API Key。
- 定期备份 `MINDSTRATE_DATA_DIR`（其中包含 SQLite、向量集合和所有 Web UI 配置）。
- LLM provider 密钥在 Web UI 中按项目治理；轮换时直接在 `Settings → LLM Configs` 修改即可，缓存会自动失效。
- 在维护窗口运行 `mindstrate doctor` 和图谱评估命令。

## 故障排查

如果 MCP 无法连接，先重新构建 MCP package，确认配置里的 command 路径正确，并重启 AI 工具。如果 Team Server 调用失败，检查 `/health`、防火墙、服务日志和 API key 是否一致。如果搜索质量较弱，确认是否已经在 Web UI `Settings → LLM Configs` 中为该项目配置 provider，或当前是否处于离线 fallback 模式（256 维本地哈希向量、跳过 LLM 抽取）。
