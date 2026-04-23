# Mindstrate 安装包

这份文档只描述**当前唯一推荐的团队安装方式**：

- 管理员部署 `Team Server + Web UI`
- 管理员发布 `install/dist/`
- 成员通过 `install.sh` / `install.ps1` 安装单文件 MCP

这个安装包的目标很单一：

- 不需要 `git clone`
- 不需要 `npm install`
- 不需要本地构建
- 只需要 `Node.js 18+`
- 只连接团队的 `Team Server`

如果你要的是**本地完整能力**，请直接使用仓库根目录的开发安装方式，而不是这里的安装包。

---

## 产物

管理员执行：

```bash
bash install/build-installer.sh
```

会生成：

```text
install/dist/
  mindstrate-mcp.js
  install.sh
  install.ps1
  manifest.json
```

其中：

- `mindstrate-mcp.js`
  单文件 MCP Server，可直接运行
- `install.sh`
  Linux / macOS 一键安装脚本
- `install.ps1`
  Windows PowerShell 一键安装脚本
- `manifest.json`
  版本与 SHA256 校验信息

---

## 管理员流程

### 1. 修改安装脚本里的 Nginx 地址

先把下面两个文件里的 `CHANGE_ME` 改成你们实际的内网地址：

- [install/install.sh](/c:/AppProject/Mindstrate/install/install.sh)
- [install/install.ps1](/c:/AppProject/Mindstrate/install/install.ps1)

例如：

```bash
http://internal.company.com/mindstrate
```

### 2. 生成发布目录

```bash
bash install/build-installer.sh
```

### 3. 上传到内网 Nginx

```bash
rsync -avz install/dist/ user@nginx:/var/www/share/mindstrate/
```

### 4. 验证

```bash
curl http://internal.company.com/mindstrate/manifest.json
```

如果能拿到 `manifest.json`，成员侧就可以安装。

---

## 成员安装

### Linux / macOS

推荐无交互安装：

```bash
curl -fsSL http://internal.company.com/mindstrate/install.sh \
  | TEAM_SERVER_URL=http://10.103.231.74:3388 \
    TEAM_API_KEY=your-team-api-key \
    TOOL=opencode \
    bash
```

也可以交互式：

```bash
curl -fsSL http://internal.company.com/mindstrate/install.sh | bash
```

### Windows PowerShell

```powershell
$env:TEAM_SERVER_URL = "http://10.103.231.74:3388"
$env:TEAM_API_KEY    = "your-team-api-key"
$env:TOOL            = "opencode"
iwr http://internal.company.com/mindstrate/install.ps1 -UseBasicParsing | iex
```

---

## 安装结果

默认安装位置：

| OS | 路径 |
|----|------|
| Linux / macOS | `~/.mindstrate-mcp/mindstrate-mcp.js` |
| Windows | `%USERPROFILE%\\.mindstrate-mcp\\mindstrate-mcp.js` |

默认会自动写 MCP 配置到这些位置：

| 工具 | 配置位置 |
|------|---------|
| OpenCode | `~/.config/opencode/config.json` |
| Cursor | `~/.cursor/mcp.json` |
| Claude Desktop (macOS) | `~/Library/Application Support/Claude/claude_desktop_config.json` |
| Claude Desktop (Windows) | `%APPDATA%\\Claude\\claude_desktop_config.json` |
| Claude Desktop (Linux) | `~/.config/Claude/claude_desktop_config.json` |

如果文件已经存在，安装器会合并 `mindstrate` 这一项，不会粗暴覆盖整个配置文件。

---

## 验证安装

安装完成后：

1. 重启 AI 工具
2. 打开 MCP 工具列表
3. 确认能看到 `memory_search`、`memory_add`、`context_assemble` 等工具

也可以手工跑一次：

```bash
TEAM_SERVER_URL=http://10.103.231.74:3388 \
TEAM_API_KEY=your-team-api-key \
node ~/.mindstrate-mcp/mindstrate-mcp.js
```

如果 stderr 里出现 `MCP Server started`，说明启动成功。

---

## 升级

升级方式只有一种：**重新跑安装脚本**。

```bash
curl -fsSL http://internal.company.com/mindstrate/install.sh | bash
```

安装器会：

- 拉最新 `manifest.json`
- 下载最新 `mindstrate-mcp.js`
- 校验 SHA256
- 替换本地单文件
- 保留现有 MCP 配置

---

## 卸载

Linux / macOS：

```bash
rm -rf ~/.mindstrate-mcp
```

Windows：

```powershell
Remove-Item -Recurse $env:USERPROFILE\.mindstrate-mcp
```

然后手动从 AI 工具的 MCP 配置里删除 `mindstrate` 这一项。

---

## 边界说明

这个安装包只负责：

- 安装 MCP 单文件
- 配置 AI 工具连接 `Team Server`

它**不负责**：

- 安装 `Team Server`
- 本地完整开发环境
- Git / P4 / hook 数据源采集

如果你需要外部数据采集，请使用：

```bash
mindstrate-scan ingest git --last-commit
mindstrate-scan ingest p4 --recent 10
mindstrate-scan hook install
```

---

## 常见问题

### Q: 报 `Cannot fetch manifest.json`

- Nginx 地址错误
- 文件没上传
- 成员机器无法访问内网地址

### Q: 报 `401 Unauthorized`

- `TEAM_API_KEY` 和服务端配置不一致

### Q: 报 `Team Server is not reachable`

- `TEAM_SERVER_URL` 不对
- 内网 / VPN 没通
- 服务器没启动
- 3388 端口不可达

### Q: 安装成功但 AI 工具里看不到工具

- 没重启 AI 工具
- 配置写到了非默认路径

### Q: 能不能自定义安装目录

可以，安装前设置：

```bash
INSTALL_DIR=/opt/mindstrate-mcp bash install.sh
```
