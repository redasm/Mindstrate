# 部署指南

本文说明 Mindstrate 支持的部署模式和运维配置。

## 环境要求

| 项目 | 要求 |
| --- | --- |
| Node.js | 18 或更高版本 |
| npm | 10 或更高版本 |
| 操作系统 | Windows、macOS 或 Linux |
| Git | 可选，用于 Git 采集工作流 |
| Perforce CLI | 可选，用于 P4 采集工作流 |
| LLM provider key | 可选，用于语义搜索和 LLM 辅助 enrichment |

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

## 本地模式

本地模式把项目数据存放在当前项目 `.mindstrate/` 目录，可选输出 Obsidian 投影。

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
TEAM_API_KEY=your-team-secret
MINDSTRATE_DATA_DIR=/data/mindstrate
OPENAI_API_KEY=sk-... # 可选
```

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
| `OPENAI_API_KEY` | OpenAI-compatible provider key |
| `OPENAI_BASE_URL` | 可选自定义 provider base URL |
| `MINDSTRATE_EMBEDDING_MODEL` | Embedding 模型名 |
| `MINDSTRATE_LOCALE` | 输出语言偏好，例如 `en` 或 `zh-CN` |
| `TEAM_PORT` | Team Server 端口 |
| `TEAM_API_KEY` | Team Server API key |
| `TEAM_SERVER_URL` | 客户端/MCP 使用的 Team Server URL |

可从 `.env.example` 和 `deploy/.env.deploy.example` 复制模板。

## 运维建议

生产环境建议：

- 将 Team Server 放在内网控制或反向代理之后。
- 生产环境设置 `TEAM_API_KEY`。
- 定期备份 `MINDSTRATE_DATA_DIR`。
- Provider 密钥不要写入仓库文件。
- 在维护窗口运行 `mindstrate doctor` 和图谱评估命令。

## 故障排查

如果 MCP 无法连接，先重新构建 MCP package，确认配置里的 command 路径正确，并重启 AI 工具。如果 Team Server 调用失败，检查 `/health`、防火墙、服务日志和 API key 是否一致。如果搜索质量较弱，确认是否已配置 embedding provider，或当前是否处于离线 fallback 模式。
