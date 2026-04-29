# Repo Scanner

`@mindstrate/repo-scanner` 是一个独立的外部采集工具。

它的职责不是直接“发明知识”，而是：

- 发现 Git / P4 等外部数据源中的新变更
- 维护扫描游标
- 收集 diff / 提交说明 / 文件列表
- 调用框架提供的知识 / 事件注入接口

当前支持：

- `ingest git`：一次性导入 Git 提交
- `ingest p4`：一次性导入 P4 changelist
- `hook install|uninstall`：安装 Git post-commit hook
- `source add-git`：注册增量 Git source
- 手动运行 / daemon 轮询 / failed item 持久化与重试

## 当前命令

```bash
mindstrate-scan ingest git --last-commit
mindstrate-scan ingest git --recent 10 --dry-run
mindstrate-scan ingest p4 --recent 10
mindstrate-scan hook install

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

## 自定义数据采集器

自定义采集器接入 repo-scanner，而不是接入 `packages/server` 的内部采集逻辑。采集器需要实现
`RepoScannerSourceAdapter<TItem>`：

```ts
import { ChangeSource, type ChangeSet } from '@mindstrate/server';
import type { RepoScannerSourceAdapter } from '@mindstrate/repo-scanner';

export const customAdapter: RepoScannerSourceAdapter<{ id: string; files: string[] }> = {
  id: 'custom-p4',
  kind: 'custom',
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
    return { type: 'changeset', project: 'my-project', changeSet };
  },
};
```

`toMindstrateInput` 只能返回三类标准输入：

- `event`：调用框架事件注入接口。
- `changeset`：交给 `mindstrate graph ingest --changes <file|->` 或 `memory.context.ingestProjectGraphChangeSet(...)` 分析。
- `bundle`：交给 portable bundle 安装/发布流程。

Git / P4 / hook / daemon / cursor / retry 都属于 repo-scanner 或采集器职责；框架只负责接收这些标准输入并解析、合并、查询、投影。

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
- 不让框架自己去读取 Git / P4 / hook 数据源
- 第一版不支持 `git-mirror`
- 第一版不支持 `git-remote`
- 第一版不支持增量 `P4 source`

如果要看完整设计，请参考：

- [docs/repo-scanner-design.md](../../docs/repo-scanner-design.md)
