# 项目检测规则

## 目标

Mindstrate 不应该只依赖硬编码的项目检测器。标准语言检测器覆盖 Node、Python、Rust 和 Go，但真实团队经常使用 Unreal、Unity、Godot、移动端项目、monorepo 或内部引擎。

项目检测规则让项目理解能力可扩展：

- Mindstrate 内置核心规则；
- 用户可以添加项目本地规则；
- 快照生成可以包含领域特定指导；
- 项目图谱可以使用规则中的 source roots、generated roots、layers 和 risk hints。

## 当前加载顺序

规则按优先级加载。当前实现支持：

1. 项目本地规则：`.mindstrate/rules/*.json`
2. Mindstrate 内置规则：`packages/server/src/project/rules/*.json`

多个规则同时命中时，`priority` 更高者获胜。优先级相同时，项目本地规则优先于内置规则。

用户全局规则和 Team Server 分发规则尚未实现。需要自定义检测时，优先把项目本地规则提交到仓库。

## 规则格式

规则是声明式 JSON。Mindstrate 不会在项目检测阶段执行用户 JavaScript 或 TypeScript。

Unreal 示例：

```json
{
  "id": "unreal-project",
  "name": "Unreal Engine Project",
  "priority": 90,
  "match": {
    "all": [
      { "glob": "*.uproject" },
      { "dir": "Content" },
      { "dir": "Config" }
    ],
    "any": [
      { "dir": "Source" },
      { "dir": "Plugins" }
    ]
  },
  "detect": {
    "language": "cpp",
    "framework": "unreal-engine",
    "packageManager": "unreal",
    "manifest": "*.uproject",
    "entryPoints": [
      "Source/**/*.Build.cs",
      "Source/**/*.Target.cs"
    ],
    "topDirs": {
      "Source": "C++ gameplay/client/server modules.",
      "Content": "Unreal assets and maps.",
      "Config": "Engine/game/project configuration.",
      "Plugins": "Project plugins and third-party extensions.",
      "Binaries": "Generated build output; do not edit manually.",
      "Intermediate": "Generated build intermediates; do not edit manually.",
      "Saved": "Local/editor generated state; do not edit manually.",
      "DerivedDataCache": "Generated asset cache; do not edit manually."
    }
  },
  "snapshot": {
    "overview": "This appears to be an Unreal Engine project.",
    "invariants": [
      "Do not edit Binaries, Intermediate, Saved, or DerivedDataCache unless explicitly requested.",
      "Prefer source, config, or plugin edits over generated output."
    ],
    "conventions": [
      "Treat .uproject as the project manifest.",
      "Treat *.Build.cs and *.Target.cs as module/build entry points."
    ]
  }
}
```

## 匹配条件

支持的 match operator：

- `file`：相对路径文件存在。
- `dir`：相对路径目录存在。
- `glob`：相对项目根的 glob。
- `readmeContains`：README 包含指定文本。
- `jsonPath`：manifest JSON 中存在指定 key/path。
- `tomlKey`：manifest TOML 中存在指定 key。
- `packageDependency`：`package.json` 中存在指定依赖。

规则可以定义：

- `all`：所有条件必须命中。
- `any`：至少一个条件命中。
- `none`：所有条件都不能命中。

## Snapshot Enrichment

规则可以增强项目快照，但不会覆盖用户 preserve block 中的内容。

支持字段：

- `snapshot.overview`
- `snapshot.invariants`
- `snapshot.conventions`
- `detect.topDirs`
- `detect.entryPoints`
- `detect.framework`
- `detect.language`
- `detect.packageManager`
- `detect.manifest`

规则生成内容应位于 preserve block 外。用户笔记仍保留在 preserve block 中，并且必须跨多次 `mindstrate init` 保留。

## 建议业务系统页（suggestedSystemPages）

检测规则可以声明 `suggestedSystemPages` —— 该项目类型常见的业务系统级架构页"启动包"。例如 Unreal 规则建议了 gameplay loop / network replication / asset loading / GAS / UMG / config 共 6 张页。这些建议**完全 opt-in**：在用户运行 `mindstrate system-pages init <key>` 之前，不会向 ECS 图注入任何节点。

```json
{
  "id": "unreal-project",
  "suggestedSystemPages": [
    {
      "key": "10-gameplay-loop",
      "title": "Gameplay Loop",
      "classifications": ["cpp-source"],
      "knownConstraints": ["..."],
      "doNotEditTargets": ["..."],
      "affectedChain": "AGameModeBase -> player controller -> pawn -> components.",
      "sourceOfTruth": ["TODO: 项目的 gameplay loop 入口 header。"],
      "recommendedVerification": ["在 PIE 跑 gameplay smoke test。"],
      "tags": ["gameplay", "loop"]
    }
  ]
}
```

字段语义：除 `key` 外其它字段均可选。`key` 是用户在 `<project>/.mindstrate/system-pages/` 下使用的文件名（不带 `.json`），它同时是内化后 ECS RULE 节点的确定 id (`architecture:system-page:<project>:<key>`)。

工作流：

1. `mindstrate system-pages list` 显示每个建议页 ✅ / ⬜，让用户看见哪些 starter 页还没填。
2. `mindstrate system-pages init <key>` 在 `<project>/.mindstrate/system-pages/<key>.json` 写入模板。如果 `<key>` 命中了某条建议，模板用规则提供的 starter 内容（title / body / classifications / constraints / source-of-truth / recommendedVerification / tags）**预填**，不再是泛化 TODO。
3. 用户把剩余的 TODO 替换为项目特定文本。
4. `mindstrate setup`（或 `mindstrate graph sync`）将页内化为确定 id 的 RULE 节点，MCP 召回随之生效。

`<project>/.mindstrate/rules/*.json` 中的项目本地规则也可以声明自己的 `suggestedSystemPages`。这适合团队级 starter 套件 —— 比如把工作室常用的全部业务子系统（战斗 / AI / 掉落 / 经济）列成建议页，新拉取代码的人 `mindstrate system-pages init combat` 一下就能拿到正确形状的页。

## 安全边界

规则是数据，不是代码。Mindstrate 应验证 JSON，并避免：

- 执行任意 JavaScript 或 TypeScript；
- 从规则运行 shell 命令；
- 读取项目根之外的文件；
- 从项目检测规则访问网络。

未来可以在显式 opt-in 下支持高级 detector plugin，但不应默认对不可信仓库启用。

## CLI 行为

`mindstrate setup` 和 `mindstrate init` 会自动使用匹配规则。未来可以增加独立的 `mindstrate rules` 命令用于校验和列出规则。

setup 输出应清楚展示检测结果：

```text
Project detection:
  Matched rule: Unreal Engine Project (project-local)
  Framework:    unreal-engine
  Manifest:     MyGame.uproject
```

## 非目标

- 完整 AST/code graph 抽取。
- LLM 生成架构总结。
- 执行用户提供的 detector 代码。
- Team Server 规则分发。

用户配置示例见 [项目配置](project-configuration.zh-CN.md)。
