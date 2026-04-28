# Mindstrate — Server Deployment

部署 Team Server + Web UI 到内网服务器，**与现有 Docker 服务（如飞书机器人）零冲突**。

## 设计要点

- 独立的 compose project (`mindstrate`)、独立网络 (`mindstrate-net`)、独立 volume (`mindstrate-data`)。**不会接触你已有的容器/网络/volume**。
- 默认监听端口：Team Server `3388`、Web UI `3377`。可改。
- 数据完全持久化在一个 named volume，`docker compose down` 不会丢数据；只有显式 `docker volume rm` 才会。
- Team Server 和 Web UI 共享同一个 SQLite 数据库（`/data` 卷）。两个容器**必须同源数据**，这是设计上的强约束，不要把它们指到不同的 volume。

## 文件清单

```
deploy/
├── docker-compose.deploy.yml   # 主 compose 文件
├── .env.deploy.example         # 配置模板（拷贝为 .env.deploy 再填）
├── team-server.Dockerfile      # Team Server 镜像
├── web-ui.Dockerfile           # Web UI 镜像
├── preflight.sh                # 部署前自检（端口/资源/冲突）
├── export-data-volume.sh       # 导出数据卷
├── restore.sh                  # 从备份恢复
└── README.md                   # 本文档
```

## 一次部署流程（5 分钟）

```bash
# 在服务器上
git clone <repo-url> Mindstrate
cd Mindstrate

# 0) 给 shell 脚本加可执行权限（Windows 上 clone 下来的脚本默认无 +x 位）
chmod +x deploy/*.sh

# 1) 配置
cp deploy/.env.deploy.example deploy/.env.deploy
# 编辑 deploy/.env.deploy，至少填 TEAM_API_KEY
#   生成一个强 key：openssl rand -hex 32
nano deploy/.env.deploy

# 2) 部署前自检（强烈建议跑一遍）
bash deploy/preflight.sh

# 3) 启动
docker compose -f deploy/docker-compose.deploy.yml \
               --env-file deploy/.env.deploy \
               up -d --build

# 4) 验证
curl http://127.0.0.1:3388/health
# {"status":"ok",...}

# Web UI 在浏览器访问：
# http://<server-ip>:3377
```

## 验证不影响现有服务

```bash
# 现有飞书机器人容器是否还在跑
docker ps

# Mindstrate 跟它在不同 network
docker network inspect mindstrate-net | grep '"Name"'

# 看资源占用
docker stats --no-stream mindstrate-team-server mindstrate-web-ui
```

## 配置 MCP 客户端连接（团队成员侧）

成员本地装好仓库并构建后，把 `mcp` 配置指向你的服务器：

```jsonc
// .cursor/mcp.json   或   opencode.json   或   claude_desktop_config.json
{
  "mcpServers": {
    "mindstrate": {
      "command": "node",
      "args": ["/path/to/Mindstrate/packages/mcp-server/dist/server.js"],
      "env": {
        "TEAM_SERVER_URL": "http://<server-ip>:3388",
        "TEAM_API_KEY": "<同 .env.deploy 里的 TEAM_API_KEY>"
      }
    }
  }
}
```

## 日常运维

```bash
# 看日志（实时）
docker compose -f deploy/docker-compose.deploy.yml --env-file deploy/.env.deploy logs -f

# 只看 team-server
docker compose -f deploy/docker-compose.deploy.yml --env-file deploy/.env.deploy logs -f team-server

# 重启（不丢数据）
docker compose -f deploy/docker-compose.deploy.yml --env-file deploy/.env.deploy restart

# 更新代码后重新构建并部署
git pull
docker compose -f deploy/docker-compose.deploy.yml --env-file deploy/.env.deploy up -d --build

# 停止（不删数据）
docker compose -f deploy/docker-compose.deploy.yml --env-file deploy/.env.deploy down
```

## 备份与恢复

```bash
# 备份（服务可继续运行；SQLite WAL 模式支持热备）
bash deploy/export-data-volume.sh
# 写到 ./data-exports/mindstrate-YYYYMMDD-HHMMSS.tgz

# 自定义目录
EXPORT_DIR=/srv/mindstrate-data-exports bash deploy/export-data-volume.sh

# 恢复（必须先停服务）
docker compose -f deploy/docker-compose.deploy.yml --env-file deploy/.env.deploy stop
bash deploy/restore.sh ./data-exports/mindstrate-20260420-101500.tgz
docker compose -f deploy/docker-compose.deploy.yml --env-file deploy/.env.deploy up -d
```

定期备份建议用 cron：
```cron
0 3 * * *  cd /opt/Mindstrate && EXPORT_DIR=/srv/mindstrate-data-exports bash deploy/export-data-volume.sh >> /var/log/mindstrate-data-export.log 2>&1
```

## 卸载（绝对不影响其他服务）

```bash
# 停止并删除容器/网络（保留数据）
docker compose -f deploy/docker-compose.deploy.yml --env-file deploy/.env.deploy down

# 同时删除数据卷（不可恢复！）
docker compose -f deploy/docker-compose.deploy.yml --env-file deploy/.env.deploy down -v

# 删除构建出来的镜像
docker rmi mindstrate/team-server:latest mindstrate/web-ui:latest
```

## 端口冲突时的处理

如果 `preflight.sh` 报 3388 / 3377 已占用，编辑 `deploy/.env.deploy`：

```bash
TEAM_PORT=4388         # 任意没被占用的端口
WEB_UI_PORT=4377
```

容器内部依然监听 3388 / 3377，只是宿主机映射的端口变了。MCP 客户端的 `TEAM_SERVER_URL` 也要相应改。

## 仅本机访问

如果你只想让本机的 reverse proxy（比如未来加一个 Nginx）转发到 Mindstrate，关掉外部端口绑定：

```bash
# .env.deploy
TEAM_BIND=127.0.0.1
WEB_UI_BIND=127.0.0.1
```

## 启用/禁用 OpenAI

不填 `OPENAI_API_KEY` 时，使用本地 hash-based embedding（精度低但完全离线）。
填了之后自动启用 OpenAI embedding 和 LLM 抽取功能。可以随时改后 `restart` 即生效。

## 故障排查

| 现象 | 原因 / 解决 |
|------|------------|
| `TEAM_API_KEY must be set` | 没填 `.env.deploy` 里的 `TEAM_API_KEY`，或 `--env-file` 没传 |
| Web UI 显示空 | 数据卷没挂上，或两个容器指向了不同的 volume — 检查 `docker volume ls` 和 compose |
| 客户端 401 Unauthorized | 客户端的 `TEAM_API_KEY` 跟服务端不一致 |
| Healthcheck 一直 unhealthy | 看 `docker logs mindstrate-team-server`；常见是 better-sqlite3 没编译进镜像 |
| 升级后 Web UI 报 502 | 等 30 秒让 Next.js 启动；或 `docker compose ... logs web-ui` |
| 想看数据库结构 | `docker exec -it mindstrate-team-server sh -c 'apt-get install -y sqlite3 && sqlite3 /data/mindstrate.db .schema'` |

## 资源占用预期

| 容器 | 内存（峰值） | 磁盘 |
|------|-------------|------|
| team-server | 100-300 MB | 镜像 ~300 MB |
| web-ui | 200-500 MB | 镜像 ~400 MB |
| 数据卷 | 1 KB / 知识 + embedding | 取决于知识量 |

跟你的飞书机器人完全不在同一进程/网络空间，互不影响。
