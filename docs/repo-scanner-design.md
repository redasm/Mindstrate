# Repo Scanner 设计草案

## 1. 目标

把 Git / P4 的“定时扫描最近若干条提交”能力设计成一个**独立工具**，而不是直接塞进 `Mindstrate` 主逻辑。

这个工具的目标是：

- 定时或手动扫描仓库的新提交 / changelist
- 做增量游标管理
- 收集 diff、提交说明、文件列表等上下文
- 把这些变更稳定地送入现有 `capture / extractor / LLM` 流程
- 避免漏扫、重复扫、扫描失败后丢进度

它**不是**：

- 检索系统
- 会话记忆系统
- 反馈闭环系统
- 知识进化系统本体
- 独立的知识提取器

它本质上是一个“增量变更收集 + capture 编排器”。

## 2. 为什么要独立做

不建议把这块逻辑直接放进 `packages/server` 的主域逻辑，原因如下：

1. 职责不同
   - `server` 负责知识存储、检索、评分、进化、会话
   - repo scanner 负责外部仓库扫描、调度、游标和失败恢复

2. 依赖面不同
   - scanner 需要依赖仓库工作副本、`git` / `p4` 可执行程序、定时任务、游标存储
   - 这些都偏基础设施，不应污染核心知识域

3. 部署方式不同
   - 有些部署只需要 Team Server，不需要扫描器
   - 有些环境可能想把扫描器放在另一台能访问仓库的机器上

4. 风险隔离
   - 即使扫描器故障，也不该影响主知识服务的可用性

## 3. 推荐包结构

建议新增一个独立 package：

```text
packages/repo-scanner/
├── package.json
├── tsconfig.json
└── src/
    ├── index.ts
    ├── types.ts
    ├── source-store.ts
    ├── scanner-service.ts
    ├── scheduler.ts
    ├── git-scanner.ts
    ├── p4-scanner.ts
    ├── ingest.ts
    └── cli.ts
```

## 4. 边界与依赖

### 4.1 允许依赖

- `@mindstrate/server`
- `@mindstrate/protocol`
- Node built-ins

可选：

- 一个轻量调度库，或者直接先用 `setInterval`

### 4.2 禁止做的事

- 不直接侵入 `Mindstrate` 的核心逻辑
- 不把 scanner 的游标和调度状态塞进主知识表
- 不让 Team Server 启动时默认强绑定 scanner
- 不在 scanner 内部重复实现一套知识抽取逻辑

## 5. 运行模式

第一版建议支持两种模式：

### 5.1 手动执行

```bash
mindstrate-scan run <source-id>
```

适合先验证单个仓库接入。

### 5.2 守护进程模式

```bash
mindstrate-scan daemon
```

后台定时轮询已启用的 source。

## 6. 数据模型

scanner 建议使用**独立 SQLite**，不要复用主知识库数据库。

推荐目录：

```text
.mindstrate-scanner/
└── scanner.db
```

### 6.1 ScanSource

表示一个被扫描的仓库源。

```ts
type ScanSourceKind = 'git' | 'p4';

interface ScanSource {
  id: string;
  kind: ScanSourceKind;
  name: string;
  project: string;
  enabled: boolean;

  repoPath?: string;       // git-local 用
  remoteUrl?: string;      // git-remote / git-mirror 用
  branch?: string;         // git 可选
  provider?: string;       // github / gitlab / gitea / generic
  credentialRef?: string;  // token / ssh key / secret name

  p4Client?: string;       // p4 用
  p4Port?: string;
  p4User?: string;

  intervalSec: number;

  lastCursor?: string;     // git: commit hash, p4: changelist number
  lastRunAt?: string;
  lastSuccessAt?: string;
  lastError?: string;

  createdAt: string;
  updatedAt: string;
}
```

### 6.2 ScanRun

表示一次实际扫描执行。

```ts
interface ScanRun {
  id: string;
  sourceId: string;
  status: 'running' | 'completed' | 'failed';

  startedAt: string;
  finishedAt?: string;

  itemsSeen: number;
  itemsImported: number;
  itemsSkipped: number;
  itemsFailed: number;

  error?: string;
}
```

### 6.3 FailedScanItem

表示单条提交 / changelist 失败记录，支持后续重试。

```ts
interface FailedScanItem {
  id: string;
  sourceId: string;
  externalId: string;   // commit hash or changelist number
  error: string;
  firstSeenAt: string;
  lastTriedAt: string;
  retryCount: number;
}
```

## 7. 游标设计

scanner 的核心不是“最近 N 条”，而是**游标增量扫描**。

### 7.1 Git 游标

- 使用 `commit hash` 作为游标
- 表示“最后一个成功处理完成的提交”

下次扫描：

- 查询 `lastCursor..HEAD`
- 按顺序逐个处理
- 全部成功后推进游标

### 7.2 P4 游标

- 使用 `changelist number`
- 表示“最后一个成功处理的 changelist”

下次扫描：

- 查询 `> lastCursor` 的 changelist
- 升序处理
- 成功后推进游标

## 8. Git 扫描流程

前提不是“必须有本地 working tree”，而是：

- scanner 所在机器必须能访问 **Git 仓库数据源**
- 这个数据源可以是：
  - 本地工作副本
  - 本地 bare repo / mirror repo
  - 远程 Git 托管服务或其 API

流程：

1. 定位 `repoPath`
2. 可选执行 `git fetch`
3. 找到当前分支 `HEAD`
4. 如果 `lastCursor` 为空：
   - 根据初始化策略决定从哪开始
5. 获取增量提交列表
6. 对每个提交：
   - 读取 commit message / diff / 作者 / 时间 / 文件列表
   - 构造 capture payload
   - 调用现有 capture / extractor / LLM 流程
7. 全部成功后推进 `lastCursor`

### 8.1 Git source 推荐分型

建议不要把 Git 只建模成“本地仓库路径”，而是至少支持下面三种访问方式：

#### A. `git-local`

- scanner 直接读取本地工作副本
- 字段重点：
  - `repoPath`
  - `branch`

优点：
- 简单
- 第一版最容易实现

缺点：
- 依赖部署机上已有仓库副本
- 可能受工作区状态影响

#### B. `git-mirror`

- scanner 自己维护一个本地 bare mirror cache
- 定期 `git fetch`
- 再从 mirror 做增量扫描

字段重点：
- `remoteUrl`
- `branch`
- `credentialRef`

优点：
- 不需要完整 working tree
- 不受未提交改动影响
- 很适合服务端集中管理多个仓库

缺点：
- 需要本地维护 mirror cache

#### C. `git-remote`

- 通过 GitHub / GitLab / Gitea API 获取提交和 diff

字段重点：
- `remoteUrl`
- `provider`
- `credentialRef`

优点：
- 不要求服务端持有本地仓库副本
- 适合 SaaS 托管仓库

缺点：
- 实现绑定 provider
- diff / patch 能力和 API 限制更复杂

### 8.2 MVP 推荐

如果做 MVP，我建议优先顺序是：

1. `git-local`
2. `git-mirror`
3. `git-remote`

其中长期更推荐 `git-mirror`，因为它兼顾通用性和稳定性。

### 8.3 第一版最终建议

虽然 Git 有三种接入方式，但**第一版只建议正式实现一种：`git-local`**。

原因：

1. 复杂度最低
   - 不需要先实现 mirror 缓存管理
   - 不需要处理 provider API 差异

2. 更容易验证主流程
   - 第一版真正要验证的是：
     - 游标是否可靠
     - 调度是否可靠
     - capture 编排是否可靠
   - 不是远程仓库接入抽象是否完美

3. 更适合快速闭环
   - 本地仓库路径 + 手动 run + 简单 daemon
   - 足够验证 scanner 的核心价值

4. 后续可平滑演进
   - 一旦 `git-local` 跑通，第二版再补 `git-mirror`
   - `git-remote` 放到更后面，不会影响主干设计

因此，第一版推荐的明确边界是：

- **支持 Git**
- **只支持 `git-local`**
- **不支持 `git-mirror`**
- **不支持 `git-remote`**

这样能最大程度降低首版实现风险。

## 9. P4 扫描流程

前提：

- scanner 所在机器已配置好 `p4` 环境
- 能访问目标 P4 数据源
- 这通常表现为：
  - 可用的 `p4` 可执行程序
  - 合法的 `P4PORT / P4USER / P4CLIENT`
  - 能访问目标 depot / workspace

流程：

1. 使用 source 配置拼出 p4 环境
2. 查询新 changelist 列表
3. 升序处理每条 changelist
4. 收集描述、文件列表、diff 等上下文
5. 构造 capture payload
6. 调用现有 capture / extractor 流程
6. 成功后推进 `lastCursor`

## 10. 与 Mindstrate 的集成方式

第一版建议使用**直接调用 `@mindstrate/server` 的现有采集链路**，而不是在 scanner 内重新实现知识抽取：

```ts
const mindstrate = new Mindstrate(...);
await mindstrate.init();
await captureService.captureCommit(...);
```

优点：

- 简单
- 少一层 HTTP
- 与现有提取 / 去重 / 质量门禁天然兼容

后续第二版可以再加“HTTP 写入 Team Server”的模式。

### 10.1 推荐的处理链

scanner 更准确的职责链应该是：

```text
Git / P4 source
  -> scanner 发现增量变更
  -> scanner 收集 diff / message / file list / metadata
  -> capture payload
  -> existing capture / extractor / LLM flow
  -> Mindstrate pipeline
  -> knowledge
```

也就是说，scanner 的输出不应被理解成“知识”，而应被理解成“待抽取的变更上下文”。

## 11. 幂等与失败恢复

### 11.1 幂等

scanner 默认是“至少一次”语义：

- 某批扫描失败时，不推进游标
- 下次可能重新处理部分提交

依赖现有 `Mindstrate` 去重能力，避免重复入库。

### 11.2 单条失败

如果某一条提交 / changelist 失败：

- 记录到 `FailedScanItem`
- 当前 run 标记失败项数
- 是否继续后续项，建议第一版：
  - 继续

### 11.3 整批失败

- 不推进 `lastCursor`
- 保留 `lastError`
- 下次继续从旧游标重试

## 12. 并发控制

必须保证同一个 source 不会并发跑两次。

建议：

- `source-store` 增加一个运行锁
- `daemon` 在调度前先尝试加锁
- 如果 source 已在运行，直接跳过

不同 source 之间可以并发。

## 13. 初始化策略

新增 source 时建议支持三种起始模式：

### 13.1 `from_now`

- 不补历史
- 直接把当前最新提交 / changelist 记为游标

适合生产快速接入。

### 13.2 `backfill_n`

- 回补最近 N 条

适合小规模导入。

### 13.3 `from_cursor`

- 用户手工指定一个 commit hash / changelist

适合高级用法。

## 14. CLI 设计

建议 CLI 独立，不污染现有 `mindstrate` 主命令。

例如：

```bash
mindstrate-scan source add-git
mindstrate-scan source add-p4
mindstrate-scan source list
mindstrate-scan source enable <id>
mindstrate-scan source disable <id>
mindstrate-scan run <id>
mindstrate-scan daemon
mindstrate-scan runs
mindstrate-scan retry-failed <id>
```

如果以后用户接受度高，再考虑把部分命令折叠进 `mindstrate scan ...`。

## 15. MVP 范围

第一版只做：

1. 独立 package：`packages/repo-scanner`
2. 独立 SQLite：`scanner.db`
3. Git 增量扫描（仅 `git-local`）
4. 手动 run
5. 简单 daemon（固定间隔）
6. 直接调用现有 capture / extractor 链路

明确不做：

- P4 第一版可以只留接口，不一定实现
- `git-mirror`
- `git-remote`
- 分布式调度
- Web UI
- 复杂 CRON
- HTTP 写入模式
- scanner 内重复实现知识抽取

## 16. 第二版演进

第二版可以增加：

- P4 增量扫描
- `git-mirror`
- 失败项重试命令
- 更丰富的状态输出
- HTTP 写入 Team Server
- 可观测性（metrics / logs）

## 17. 第三版演进

第三版可以考虑：

- `git-remote`
- 多分支 Git 策略
- 更复杂的回补规则
- 与 Team Server 的集中管理
- Web UI 管理 source / runs

## 18. 一句话结论

repo scanner 最合理的落地方式是：

- **做成独立 package**
- **用独立 SQLite 存 source / cursor / run**
- **第一版只做 Git 增量扫描 + 手动 run + 简单 daemon**
- **通过现有 capture / extractor / LLM 流程把变更送入主知识链路**

这样既不会污染 `Mindstrate` 主逻辑，又能把“服务端定时扫描仓库”做成一个真正可靠、可恢复、可扩展的变更编排工具。
