# @mindstrate/repo-scanner

`@mindstrate/repo-scanner` 是 Mindstrate 的外部数据采集工具。

它负责 Git、Perforce、hook、daemon 轮询、游标、失败项重试和自定义 source adapter。核心框架只接收标准 Mindstrate 输入，不直接读取 Git/P4/watch 数据源。

常用命令：

```bash
mindstrate-scan ingest git --last-commit --project my-project
mindstrate-scan ingest p4 --recent 10 --project my-project
mindstrate-scan hook install
mindstrate-scan source add-git --name repo --project my-project --repo-path .
mindstrate-scan daemon
```

详细文档 / Documentation:

- [数据采集指南](../../docs/data-collection.zh-CN.md)
- [Data Collection Guide](../../docs/data-collection.en.md)
- [Repo Scanner 设计](../../docs/repo-scanner-design.md)
