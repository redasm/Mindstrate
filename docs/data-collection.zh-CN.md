# 数据采集指南

Mindstrate 把外部数据采集放在核心框架之外。

当前边界：

- `packages/repo-scanner` 负责 Git、Perforce、hook、daemon 轮询、游标、失败项重试和自定义 source adapter。
- `packages/server` 负责标准输入摄入、项目图谱解析/合并/查询/投影、会话和知识 API。
- CLI 和 MCP 只暴露这些 API，不让框架自己读取 Git、Perforce 或 watcher 状态。

## 标准输入

外部采集器应该把原始数据转换为以下三类 Mindstrate 输入：

| 输入 | 用途 | 接入路径 |
| --- | --- | --- |
| `event` | Git、测试、LSP、终端、用户反馈等信号 | `memory.events.ingestEvent(...)` |
| `changeset` | 项目图谱变更影响分析 | `memory.context.ingestProjectGraphChangeSet(...)` 或 `mindstrate graph ingest --changes` |
| `bundle` | 可移植上下文图数据 | `memory.bundles.installBundle(...)` 或发布流程 |

项目图谱 `ChangeSet` 示例：

```json
{
  "source": "p4",
  "base": "123",
  "head": "124",
  "files": [
    {
      "path": "Source/Client/Client.Build.cs",
      "oldPath": "Source/OldClient/Client.Build.cs",
      "status": "renamed",
      "language": "csharp",
      "layerId": "gameplay-cpp"
    }
  ]
}
```

分析变更：

```bash
mindstrate graph ingest --changes changeset.json
cat changeset.json | mindstrate graph ingest --changes -
```

## Git 一次性采集

```bash
mindstrate-scan ingest git --last-commit --project my-project
mindstrate-scan ingest git --commit abc1234 --project my-project
mindstrate-scan ingest git --recent 10 --project my-project
mindstrate-scan ingest git --recent 5 --project my-project --dry-run
```

设置 `TEAM_SERVER_URL` 和 `TEAM_API_KEY` 后，scanner 会直接写入 Team Server：

```bash
TEAM_SERVER_URL=http://team-server:3388 \
TEAM_API_KEY=<key> \
mindstrate-scan ingest git --last-commit --project my-project
```

## Git Hook

安装 post-commit hook：

```bash
cd /path/to/repo
mindstrate-scan hook install
```

卸载：

```bash
mindstrate-scan hook uninstall
```

hook 会调用 `mindstrate-scan ingest git --last-commit`。hook 逻辑属于 `repo-scanner`，不要把 watcher/hook 采集逻辑加回 `packages/server`。

## 增量 Git Source

> **团队模式提示**：管理员也可以在 Web UI `Settings → Scanner Sources` 中按项目添加/编辑/启停 Git 与 P4 source，daemon 会读取相同的 SQLite 表。CLI 仍然可用，主要面向个人本地模式或脚本化场景。

注册 source：

```bash
mindstrate-scan source add-git \
  --name app \
  --project my-project \
  --repo-path /path/to/repo \
  --branch main \
  --interval-sec 300 \
  --init-mode from_now
```回填最近提交：

```bash
mindstrate-scan source add-git \
  --name app \
  --project my-project \
  --repo-path /path/to/repo \
  --init-mode backfill_recent \
  --backfill-count 20
```

手动执行一次：

```bash
mindstrate-scan run <source-id>
```

daemon 模式：

```bash
mindstrate-scan daemon --tick-ms 30000
```

查看和恢复：

```bash
mindstrate-scan status <source-id>
mindstrate-scan runs <source-id>
mindstrate-scan failed <source-id>
mindstrate-scan retry-failed <source-id>
```

scanner 状态存放在独立数据库：

```text
~/.mindstrate-scanner/scanner.db
```

### Git 认证：使用 PAT / Deploy Token

如果远端 Git 服务器需要鉴权（私有仓库），在 Scanner Source 的 `Auth token` 字段填入 **Personal Access Token** 或 **Deploy Token**。

填写规则按是否含冒号自动分流：

| 填写格式 | scanner 注入的 Authorization 头 | 适用服务器 |
| --- | --- | --- |
| `ghp_xxx` / `glpat-xxx` / `xoxp-xxx`（无冒号）| `Bearer <token>` | GitHub PAT、Bitbucket Server PAT |
| `token-name:token-value`（含冒号）| `Basic base64(token-name:token-value)` | GitLab Deploy Token、Gitea PAT/Token、自建 Git |
| `oauth2:<gitlab-pat>` | `Basic base64(oauth2:<gitlab-pat>)` | GitLab PAT 走 Git HTTPS |
| `:<azure-devops-pat>`（冒号开头）| `Basic base64(:<pat>)` 空用户名 | Azure DevOps PAT |

**不要** 用账号密码 —— 密码会泄漏到 `.git/config` 和容器 `ps` 输出里，且无法独立吊销。

各家 Git 服务器 Token 入口：

| 服务器 | 入口 | 推荐权限 |
| --- | --- | --- |
| GitHub | Settings → Developer settings → Personal access tokens（classic 或 fine-grained）| 只勾 `repo:read` |
| GitLab | User Settings / Project / Group → Access Tokens | `read_repository` |
| Gitea | User Settings → Applications → Generate New Token | `repository: read` |
| Bitbucket Server | Personal access tokens | Project read |
| Azure DevOps | User Settings → Personal access tokens | `Code: Read` |

如果服务器只支持 SSH，可以在 scanner 容器/主机里部署一份 SSH key 并在 Git 服务器配置 deploy key，把 `Remote URL` 填成 `git@host:org/repo.git`，`Auth token` 留空。

### 大仓库（>10 GB）部署模式

scanner 默认会把远端 git 仓库以 `git clone --mirror` 形式拉到 `${REPO_SCANNER_REPOS_DIR}/<source-id>`（默认 `/repos/<uuid>`），整个 blob 历史都会保留。对几百 G 的代码仓库，这个成本通常不可接受。

推荐做法：**自行在服务器维护一份 bare mirror，scanner 只读不克隆**。Scanner Source 表单里填 `Local repo path`、留空 `Remote URL`：

```bash
# 一次性建好 mirror（首次较慢）
git clone --mirror https://github.com/big-org/giant-repo.git /srv/git-mirrors/giant-repo.git

# 后续保持新鲜（cron 每 5 分钟）
*/5 * * * * cd /srv/git-mirrors/giant-repo.git && git fetch --prune --quiet
```

UI 里 Source 配置：

```text
Kind:           git
Local repo path: /srv/git-mirrors/giant-repo.git
Remote URL:      （留空）
```

scanner 检测到 `repoPath` 已存在且 `remoteUrl` 为空，会直接基于该路径运行 `git log` / `git diff`，不会做任何 `git clone` / `git fetch`，不占额外磁盘。如果你还想用 partial / treeless 减少 mirror 自身体积：

```bash
git clone --mirror --filter=blob:none https://github.com/big-org/giant-repo.git /srv/git-mirrors/giant-repo.git
```

`--filter=blob:none` 让 mirror 只存 commit 和 tree metadata，blob 在需要 diff 内容时按需从远端拉。对代码仓库通常能省下 10–100x 空间，需要 Git 服务器支持 partial clone 协议（GitHub / GitLab / Gitea 都支持）。

## Perforce 采集

一次性采集：

```bash
mindstrate-scan ingest p4 --changelist 12345 --project my-project
mindstrate-scan ingest p4 --recent 10 --project my-project
mindstrate-scan ingest p4 --recent 20 --depot //depot/MyProject/... --project my-project
mindstrate-scan ingest p4 --recent 10 --project my-project --dry-run
```

服务端 trigger 示例：

```text
mindstrate-capture change-commit //depot/... "mindstrate-scan ingest p4 --changelist %changelist% --project my-project"
```

客户端 cron 示例：

```cron
*/30 * * * * mindstrate-scan ingest p4 --recent 5 --project my-project 2>/dev/null
```

Windows 计划任务：

```batch
schtasks /create /tn "Mindstrate-P4-Scan" /tr "mindstrate-scan ingest p4 --recent 5 --project my-project" /sc minute /mo 30
```

## 自定义采集器

自定义采集器实现 `RepoScannerSourceAdapter<TItem>`，输出标准 Mindstrate 输入。

```ts
import { ChangeSource, type ChangeSet } from '@mindstrate/server';
import type { RepoScannerSourceAdapter } from '@mindstrate/repo-scanner';

export const p4ReviewAdapter: RepoScannerSourceAdapter<{ id: string; files: string[] }> = {
  id: 'p4-review',
  kind: 'p4-review',
  async discover({ sourceId, cursor }) {
    return {
      cursor: '101',
      items: [{ id: '101', files: ['Source/Client/Client.Build.cs'] }],
    };
  },
  async toMindstrateInput(item) {
    const changeSet: ChangeSet = {
      source: ChangeSource.P4,
      head: item.id,
      files: item.files.map((file) => ({ path: file, status: 'modified' })),
    };

    return {
      type: 'changeset',
      project: 'my-project',
      changeSet,
    };
  },
};
```

采集器职责：

- 发现外部变更；
- 维护或接收 cursor；
- 把原始 source item 转换成标准 Mindstrate 输入；
- 处理失败项重试；
- 避免发送密钥或不必要的源码内容。

框架职责：

- 校验和摄入 event；
- 分析项目图谱 `ChangeSet`；
- 安装 bundle；
- 提供查询和投影 API。

## 项目图谱变更分析

`mindstrate graph ingest --changes` 不读取或修改 Git/P4。它只把变更文件映射到项目图谱节点、层、风险提示和建议查询。

输出示例：

```text
Source: p4
Files: 1
Affected nodes: 2
Affected layers: gameplay-cpp

Risk hints:
  - Do not edit generated Unreal output unless explicitly requested.

Suggested queries:
  - mindstrate graph context Source/Client/Client.Build.cs
```

建议在大型项目、Unreal 项目、生成目录较多的项目、monorepo 或自定义采集器场景中，在 Agent 编辑代码前先运行变更分析。

## 安全建议

- Git auth token、P4 password 等扫描源凭据通过 Web UI `Settings → Scanner Sources`（或 CLI `mindstrate-scan source add-*`）保存在共享 SQLite，与项目 LLM API Key 同等处理；不要把它们写回环境变量或仓库文件。
- `TEAM_SERVER_URL` 和 `TEAM_API_KEY` 优先使用环境变量，且 `TEAM_API_KEY` 仅作为管理员引导密钥；成员密钥由 Web UI 签发，并按项目限定可访问范围。
- 自定义 collector 是受信任代码；不可信仓库只使用声明式 project rules。
- scanner cursor DB 和 Mindstrate 知识 DB 保持分离。
