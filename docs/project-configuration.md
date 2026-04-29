# 项目配置

Mindstrate 的项目级配置放在 `.mindstrate/` 下。

这里有三个概念需要区分：

- `.mindstrate/project.json`：项目身份信息，由 `mindstrate init` 或 `mindstrate setup` 写入。
- `.mindstrate/config.json`：CLI/setup 默认配置，例如模式、数据目录、AI 工具、vault、Team Server URL。
- `.mindstrate/rules/*.json`：自定义项目检测规则，用于补充快照和项目图谱 hints。

本地数据库和向量文件也在 `.mindstrate/` 下，但默认被 Git 忽略。

## `.mindstrate/project.json`

`project.json` 可以提交到仓库。它让协作者在同一项目中重新运行 `mindstrate init` 时保持稳定项目身份，而不是完全依赖自动发现。

示例：

```json
{
  "version": 1,
  "name": "my-project",
  "rootHint": "/Users/me/code/my-project",
  "language": "typescript",
  "framework": "react",
  "snapshotKnowledgeId": "project-snapshot:...",
  "createdAt": "2026-04-29T10:00:00.000Z",
  "updatedAt": "2026-04-29T10:00:00.000Z",
  "fingerprint": "typescript|react|@vitejs/plugin-react,react,vite"
}
```

字段说明：

| 字段 | 含义 |
| --- | --- |
| `version` | meta 文件 schema 版本，当前为 `1`。 |
| `name` | 检测到的项目名。 |
| `rootHint` | 上次 init 时的绝对路径，仅作提示，不作为权威路径。 |
| `language` | 检测到的主要语言。 |
| `framework` | 检测到的框架。 |
| `snapshotKnowledgeId` | 项目快照知识的稳定 ID。 |
| `createdAt` / `updatedAt` | ISO 时间戳。 |
| `fingerprint` | 由依赖、语言、框架生成的 fingerprint，用于跳过无意义快照更新。 |

`mindstrate init` 会创建 `.mindstrate/.gitignore`，忽略本地 DB 文件，同时允许提交 `project.json`。

## `.mindstrate/config.json`

`config.json` 由 `mindstrate setup` 写入，CLI 会读取它作为默认配置。

个人模式示例：

```json
{
  "version": 1,
  "mode": "local",
  "tool": "cursor",
  "vaultPath": "/Users/me/Documents/MindstrateVault",
  "dataDir": ".mindstrate"
}
```

团队模式示例：

```json
{
  "version": 1,
  "mode": "team",
  "tool": "opencode",
  "teamServerUrl": "http://team-server:3388",
  "dataDir": ".mindstrate"
}
```

字段说明：

| 字段 | 含义 |
| --- | --- |
| `version` | 配置 schema 版本，当前为 `1`。 |
| `mode` | `local` 或 `team`。 |
| `dataDir` | 项目相对的数据目录。 |
| `tool` | `cursor`、`opencode`、`claude-desktop` 或 `all`。 |
| `vaultPath` | 个人模式下可选的 Obsidian vault 路径。 |
| `teamServerUrl` | 团队模式下可选的 Team Server URL。 |

不要提交密钥。`TEAM_API_KEY` 应该放在环境变量或生成的 MCP 配置中，不应该进入共享项目配置。

## 内置项目规则

Mindstrate 内置声明式检测规则，位于：

```text
packages/server/src/project/rules/
```

当前包含：

- `react-project.json`
- `vite-project.json`
- `vue-project.json`
- `nextjs-project.json`
- `nuxt-project.json`
- `unreal-project.json`

规则可以提供：

- 检测条件；
- framework / language / package manager hints；
- entry points；
- 顶层目录说明；
- snapshot overview / invariants / conventions；
- parser / query / convention extractor hints；
- source roots 和 generated roots；
- risk hints；
- project graph layers。

## 自定义项目规则

项目本地规则放在：

```text
.mindstrate/rules/*.json
```

自定义规则匹配时可以覆盖内置规则。优先级更高的规则获胜；优先级相同则项目本地规则优先。

最小示例：

```json
{
  "id": "internal-service",
  "name": "Internal Node Service",
  "priority": 95,
  "match": {
    "all": [
      { "file": "package.json" },
      { "dir": "src" },
      { "packageDependency": "express" }
    ]
  },
  "detect": {
    "language": "typescript",
    "framework": "internal-service",
    "manifest": "package.json",
    "entryPoints": ["src/server.ts"],
    "topDirs": {
      "src": "Service source code.",
      "config": "Runtime configuration.",
      "migrations": "Database migration files."
    }
  },
  "snapshot": {
    "overview": "This is an internal HTTP service.",
    "invariants": [
      "Do not change migration history after it has been applied.",
      "Keep request validation near route boundaries."
    ],
    "conventions": [
      "Treat src/server.ts as the process entry point.",
      "Prefer config files over hard-coded environment names."
    ]
  },
  "sourceRoots": ["src"],
  "generatedRoots": ["dist", "coverage"],
  "ignore": ["node_modules", "dist", "coverage"],
  "riskHints": [
    "Do not edit generated build output."
  ],
  "layers": [
    {
      "id": "service-source",
      "label": "Service Source",
      "roots": ["src"],
      "language": "typescript",
      "parserAdapters": ["tree-sitter-source"],
      "queryPacks": ["typescript"],
      "changeAdapters": ["git"]
    }
  ]
}
```

## 规则字段速查

| 字段 | 含义 |
| --- | --- |
| `id` | 稳定规则 ID。 |
| `name` | 人类可读名称。 |
| `priority` | 优先级，数值越大越优先。 |
| `match` | 判断规则是否命中的条件。 |
| `detect` | 项目身份和结构 hints。 |
| `snapshot` | 项目快照文本 hints。 |
| `parserAdapters` | Parser adapter ID。 |
| `queryPacks` | Query pack ID。 |
| `conventionExtractors` | Convention extractor ID。 |
| `sourceRoots` | 源码目录。 |
| `generatedRoots` | 生成目录，用于忽略和风险提示。 |
| `ignore` | 额外项目图谱忽略路径。 |
| `manifests` | manifest 文件或 glob。 |
| `riskHints` | 变更分析时展示的风险提示。 |
| `layers` | 项目图谱层定义。 |

支持的 match operator：

- `file`
- `dir`
- `glob`
- `readmeContains`
- `jsonPath`
- `tomlKey`
- `packageDependency`

支持的 match group：

- `all`：所有条件都必须命中。
- `any`：至少一个条件命中。
- `none`：所有条件都不能命中。

## Project Graph Layers

layers 用于让变更分析解释“受影响区域”。

```json
{
  "id": "gameplay-cpp",
  "label": "Gameplay C++",
  "roots": ["Source", "Plugins"],
  "language": "cpp",
  "parserAdapters": ["tree-sitter-source", "unreal-build"],
  "queryPacks": ["cpp-light", "csharp-build-light"],
  "changeAdapters": ["git", "p4"]
}
```

layer 字段：

| 字段 | 含义 |
| --- | --- |
| `id` | 稳定 layer ID。 |
| `label` | 人类可读名称。 |
| `roots` | 属于该层的路径。 |
| `language` | 可选语言 hint。 |
| `parserAdapters` | 该层的 parser adapters。 |
| `queryPacks` | 该层的 query packs。 |
| `conventionExtractors` | 可选 convention extractor ID。 |
| `changeAdapters` | `git`、`p4`、`filesystem` 或 `manual`。 |
| `generated` | 标记为生成输出层。 |

## 安全边界

项目规则是声明式 JSON 数据。Mindstrate 不会执行规则中的 JavaScript、shell 命令或网络请求。这样可以安全检查不可信仓库。

更完整的规则设计见 [项目检测规则](project-detection-rules.md)。
