# Mindstrate MCP Server — Installer

让团队成员**不需要 git clone、不需要 npm install、不需要构建**就能用上 Mindstrate MCP Server。

> v0.2 起 MCP Server 是 esbuild 打包的**单文件**（约 1.2 MB）。
> 不再有 tarball、node_modules、native 模块依赖。
> 团队成员只需要 Node.js 18+ 和能访问内网 Nginx 的网络。

## 工作流程

```
管理员                                                团队成员
  │                                                     │
  │ 1. bash install/build-installer.sh                  │
  │      ↓                                              │
  │    install/dist/                                    │
  │      ├── mindstrate-mcp.js   (1.2 MB 单文件)      │
  │      ├── install.sh                                 │
  │      ├── install.ps1                                │
  │      └── manifest.json                              │
  │                                                     │
  │ 2. rsync install/dist/ → 内网 Nginx                  │
  │      http://<nginx>/mindstrate/                  │
  │                                                     │
  │ 3. 把这一行扔到团队群里 ─────────────────────────►   │ 4. 复制粘贴一行命令搞定
                                                        │      curl -fsSL <url>/install.sh | bash
                                                        │      （会交互式问 TEAM_API_KEY 等）
```

---

## 管理员侧：发布

### 一次性准备

打包脚本和安装脚本里需要把 Nginx 地址改成你内网真实地址。

打开 `install/install.sh` 找到这一行：
```bash
NGINX_BASE="${NGINX_BASE:-http://CHANGE_ME/mindstrate}"
```
改成你的真实地址，比如：
```bash
NGINX_BASE="${NGINX_BASE:-http://internal.company.com/mindstrate}"
```

`install/install.ps1` 里也搜 `CHANGE_ME` 改掉。

### 每次发布

```bash
# 在你的开发机
bash install/build-installer.sh

# 输出 install/dist/，4 个文件
ls install/dist/
# mindstrate-mcp.js   (~1.2 MB)
# install.sh
# install.ps1
# manifest.json

# 上传到内网 Nginx
rsync -avz install/dist/ user@nginx:/var/www/share/mindstrate/

# 验证 Nginx 能 GET 到这 4 个文件
curl http://internal.company.com/mindstrate/manifest.json
```

### Nginx 配置示例

```nginx
location /mindstrate/ {
    alias /var/www/share/mindstrate/;
    autoindex on;
    types {
        application/json json;
        text/x-shellscript sh;
        text/plain ps1;
        application/javascript js;
    }
}
```

---

## 团队成员侧：安装

### Linux / macOS

```bash
curl -fsSL http://internal.company.com/mindstrate/install.sh | bash
# 交互式问：
#   - Team Server URL: http://10.103.231.74:3388
#   - Team Server API Key: <管理员给的 key>
#   - 装到哪个 AI 工具: opencode (默认)
```

或者无交互一行：
```bash
curl -fsSL http://internal.company.com/mindstrate/install.sh \
  | TEAM_SERVER_URL=http://10.103.231.74:3388 \
    TEAM_API_KEY=43e442d7aa3aca3fc3b36dfd3c78c00f2581263e0b16ff9b303f0bae0761aba1 \
    TOOL=opencode \
    bash
```

### Windows PowerShell

```powershell
$env:TEAM_SERVER_URL = "http://10.103.231.74:3388"
$env:TEAM_API_KEY    = "43e442d7aa3aca3fc3b36dfd3c78c00f2581263e0b16ff9b303f0bae0761aba1"
$env:TOOL            = "opencode"
iwr http://internal.company.com/mindstrate/install.ps1 -UseBasicParsing | iex
```

### 装到哪些目录

| OS | 安装位置（可被 `INSTALL_DIR` 覆盖） |
|----|-----------------------------------|
| Linux/macOS | `~/.mindstrate-mcp/mindstrate-mcp.js` |
| Windows | `%USERPROFILE%\.mindstrate-mcp\mindstrate-mcp.js` |

只是一个 `.js` 文件，没有 node_modules，没有任何其他文件。卸载就是 `rm` 这个目录。

MCP 配置文件被自动写入：

| 工具 | 配置位置 |
|------|---------|
| OpenCode | `~/.config/opencode/config.json`（可被 `OPENCODE_CONFIG` 覆盖） |
| Cursor | `~/.cursor/mcp.json`（可被 `CURSOR_CONFIG` 覆盖） |
| Claude Desktop (macOS) | `~/Library/Application Support/Claude/claude_desktop_config.json` |
| Claude Desktop (Windows) | `%APPDATA%\Claude\claude_desktop_config.json` |
| Claude Desktop (Linux) | `~/.config/Claude/claude_desktop_config.json` |

如果配置文件已存在，安装器会**合并**新条目（用 `jq` / PowerShell 原生），不会破坏你已有的其他 MCP 服务。

### 验证安装

```bash
# 看安装结果
ls -la ~/.mindstrate-mcp/mindstrate-mcp.js

# 手动启动一次确认能连上 Team Server
TEAM_SERVER_URL=http://10.103.231.74:3388 \
TEAM_API_KEY=...your-key... \
node ~/.mindstrate-mcp/mindstrate-mcp.js
# 看到 "MCP Server started ... mode: team" 就 OK
# Ctrl+C 退出
```

然后**重启** OpenCode / Cursor / Claude Desktop（必须重启，它们启动时才读 MCP 配置）。

### 升级（同一个命令）

直接重跑 install 命令。脚本会：
- 拉最新 manifest + bundle
- 校验 SHA256
- 替换单文件
- **保留** MCP 配置不动

```bash
curl -fsSL http://internal.company.com/mindstrate/install.sh | bash
```

### 从旧版本升级（v0.1 → v0.2）

旧版本（v0.1）安装到 `~/.mindstrate-mcp/packages/mcp-server/dist/server.js`，
新版本（v0.2）安装到 `~/.mindstrate-mcp/mindstrate-mcp.js`。

升级时 install.sh 会：
1. 把整个 `~/.mindstrate-mcp` 清空（除了 `.env`）
2. 写入新的单文件
3. 自动重新生成 MCP 配置，指向新路径

**唯一要做的事**：升级后重启 AI 工具一次。**MCP 配置已经被脚本自动更新指向新路径**。

> 如果你在 AI 工具的配置里手工写过 `"args": ["...packages/mcp-server/dist/server.js"]` 这种旧路径，
> 升级后那条路径不再存在。重新跑 install 让它写正确的新路径，或手动改成 `"args": ["~/.mindstrate-mcp/mindstrate-mcp.js"]`。

### 卸载

```bash
# Linux/Mac
rm -rf ~/.mindstrate-mcp
# 然后手动从 OpenCode/Cursor/Claude 配置里删 "mindstrate" 这一段

# Windows
Remove-Item -Recurse $env:USERPROFILE\.mindstrate-mcp
```

---

## 常见问题

### Q: 报 "Cannot fetch manifest.json"
- Nginx 地址错或服务器不通
- 跑 `curl -v http://<nginx>/mindstrate/manifest.json` 看具体错误

### Q: 安装成功但 OpenCode 看不到 memory_* 工具
- 没重启 OpenCode
- 配置文件被装到了非默认位置 — 用 `OPENCODE_CONFIG=...` 强制指定

### Q: 报 "401 Unauthorized"
- `TEAM_API_KEY` 跟服务端 `.env.deploy` 里的不一致

### Q: 报 "Team Server is not reachable"
- 公司内网 / VPN 没连
- 服务器防火墙没放行 3388

### Q: 我自己的项目里有 `opencode.json`，会被覆盖吗？
- 不会。安装器写的是**用户全局**配置（`~/.config/opencode/config.json`）
- 项目级的 `opencode.json` 完全不动

### Q: 单文件大小是 1.2 MB，gzip 后呢？
- 大约 350 KB。Nginx 启用 gzip 后下载几乎瞬间完成

### Q: 我能不能不装到默认目录？
- 装之前设：`INSTALL_DIR=/opt/mindstrate bash install.sh`

### Q: 这个单文件怎么这么干净，没有 node_modules？
- esbuild 把所有运行时代码（约 1.2 MB JavaScript）打成一个文件
- 协议层 + HTTP 客户端都在里面
- **不依赖** native 模块（better-sqlite3 那些都在服务端）
- **不依赖** 任何 npm 包（全打进去了）

### Q: 我想本地不装 Team Server 也能用 Mindstrate，怎么办？
- 这种情况你需要本地完整安装——`git clone` + `npx turbo build` + `mindstrate init`
- 单文件分发包专门是给"连接团队服务器"的场景准备的
- 后续如果发布到 npm，可以 `npm install -g @mindstrate/server` 拿到本地完整能力
