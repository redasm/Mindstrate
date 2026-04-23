# Repo Scanner

`@mindstrate/repo-scanner` 是一个独立的增量变更扫描工具。

它的职责不是直接“发明知识”，而是：

- 发现仓库中的新提交
- 维护扫描游标
- 收集 diff / 提交说明 / 文件列表
- 调用现有 `Mindstrate` capture / extractor / LLM 流程

当前第一版只支持：

- `git-local`
- 手动运行
- 简单 daemon 轮询
- failed item 持久化与重试

## 当前命令

```bash
mindstrate-scan source add-git --name my-repo --project my-project --repo-path /path/to/repo
mindstrate-scan source list
mindstrate-scan source enable <source-id>
mindstrate-scan source disable <source-id>

mindstrate-scan run <source-id>
mindstrate-scan status <source-id>
mindstrate-scan runs <source-id>
mindstrate-scan failed <source-id>
mindstrate-scan retry-failed <source-id>

mindstrate-scan daemon
```

## 存储位置

scanner 使用独立 SQLite，不污染主知识库：

```text
~/.mindstrate-scanner/scanner.db
```

除非显式指定 `scannerDbPath`，否则默认写到上面的路径。

## 接入流程

### 1. 添加一个本地 Git source

```bash
mindstrate-scan source add-git \
  --name my-repo \
  --project my-project \
  --repo-path /path/to/repo
```

可选：

- `--branch main`
- `--interval-sec 300`
- `--init-mode from_now`
- `--init-mode backfill_recent --backfill-count 10`

### 2. 手动执行一次

```bash
mindstrate-scan run <source-id>
```

返回内容会包含：

- `mode`
- `itemsSeen`
- `itemsImported`
- `itemsSkipped`
- `itemsFailed`
- `cursor`

### 3. 查看状态

```bash
mindstrate-scan status <source-id>
```

状态会包含：

- source 配置
- recent runs
- failed items

### 4. 启动 daemon

```bash
mindstrate-scan daemon --tick-ms 30000
```

daemon 会定期轮询已启用 source，并执行增量扫描。

## 失败项处理

如果某次扫描中某个 commit 处理失败，它会被记录到失败项表中。

查看失败项：

```bash
mindstrate-scan failed <source-id>
```

重试失败项：

```bash
mindstrate-scan retry-failed <source-id>
```

## 设计边界

repo-scanner 故意不做这些事：

- 不直接改 `Mindstrate` 主逻辑
- 不复用主知识库 SQLite 存游标
- 不在 scanner 内重复实现知识抽取
- 第一版不支持 `git-mirror`
- 第一版不支持 `git-remote`
- 第一版不支持 `P4`

如果要看完整设计，请参考：

- [docs/repo-scanner-design.md](../../docs/repo-scanner-design.md)
