# 系统页 — 自定义项目架构文档

每次运行 `mindstrate setup`、`mindstrate init --with-vault`，或
`mindstrate graph sync` 时，Mindstrate 会在
`<vault>/<project>/architecture/` 下生成一组架构页。这些页面服务两类
读者：

1. **人类**：在 Obsidian 中浏览项目时，先读这里再下钻到原始图节点。
2. **AI 智能体**：通过 MCP 检索（`context_assemble`、
   `query_project_graph_task before-edit | impact`、
   `search_graph_knowledge`）读取同一份页面——它们被
   `internalize-system-pages.ts` 内化为 `RULE + ARCHITECTURE` 节点。

页面由 **三层** 组合，从低到高优先级。同一个 page key（例如
`00-overview`）由最高层定义的版本胜出。

## 第一层 — 通用骨架（内置，永远写出）

源码：`packages/server/src/project-graph/obsidian-system-pages-generic.ts`。

骨架是 **语言无关** 的，只使用项目检测器已经填充的字段
（`language`、`framework`、`packageManager`、`entryPoints`、
`scripts`、`topDirs`、`manifestPath`、`workspaces`）。它包含三页：

| Key                     | 用途                                        |
| ----------------------- | ------------------------------------------- |
| `00-overview`           | 项目名、框架、语言、顶层目录布局。          |
| `01-entry-and-scripts`  | 检测到的入口点和 `package.json` 脚本。       |
| `02-validation-playbook`| 验证策略以及检测到的 `test/build/lint`。     |

骨架不会出现任何 stack 名称（没有 `UCLASS`、没有 `pyproject.toml`、
没有 `Cargo.toml`）。检测器没认出来的项目仍然能拿到一份可用的入门页。

## 第二层 — Stack 架构 preset（来自检测规则）

源：检测规则通过 `"systemPagesInclude"` 引用的 **JSON include 文件**。

检测规则可以通过加上下面这一行携带一整本架构手册：

```json
{
  "id": "unreal-project",
  "systemPagesInclude": "unreal-architecture-pages.json",
  "match": { "all": [{ "glob": "*.uproject" }, { "dir": "Content" }, { "dir": "Config" }] }
}
```

include 文件放在规则旁边，结构是：

```json
{
  "en": [ { "key": "00-overview", ... }, { "key": "01-runtime-lifecycle", ... } ],
  "zh": [ { "key": "00-overview", ... }, ... ]
}
```

每条目遵循 `RuleSystemPagePreset` 形状（见
`packages/server/src/project/detector.ts`）：

| 字段                   | 必填 | 说明                                                                                   |
| ---------------------- | ---- | -------------------------------------------------------------------------------------- |
| `key`                  | 是   | 稳定 id。同 key 覆盖第一层。                                                            |
| `name`                 | 是   | 落盘文件名（如 `02-cpp-typescript-bridge.md`）。                                        |
| `title`                | 是   | Markdown `# H1`。支持 `${project.name}` / `${project.framework}` / `${project.language}` 等占位。 |
| `body`                 | 是   | Markdown 行数组。支持两个占位行，见"正文模板化"。                                      |
| `overlays`             | 是   | YAML overlay 块（kind/risk/correction/...）。                                          |
| `userNotesTitle`       | 是   | 用户可编辑笔记块的 section 标题。                                                       |
| `userNotesPlaceholder` | 是   | 用户可编辑笔记块的默认正文。                                                            |
| `overlayTitle`         | 是   | 结构化 overlay 块的 section 标题。                                                      |
| `metadata`             | 否   | 驱动 MCP `before-edit` / `impact` 报告，见"metadata 字段"。                            |

如果当前 locale 是 `zh`，但 include 文件只提供了 `en`（或反之），
另一个 locale 会作为 fallback。这样一份 stack preset 可以渐进地补
足第二种语言。

### 正文模板化

两条声明式占位行会在渲染时展开，preset 自身保持运行时数据无关：

| 占位行                                       | 替换为                                                                                                |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `<!-- mindstrate:operation-manual -->`       | `renderProjectOperationManualSections(project)`——规则没有 `operationManual` 时为空。                |
| `<!-- mindstrate:generated-roots -->`        | `project.graphHints.generatedRoots` 的 bullet 列表，空时为 `- (no generated roots declared)`。         |

Token 替换同样适用于 `title` 以及任何非占位的 `body` 行：

- `${project.name}` → `project.name`
- `${project.framework}` → `project.framework ?? 'unknown'`
- `${project.language}` → `project.language ?? 'unknown'`

### Metadata 字段

`metadata` 让页面参与 MCP task 报告。完整的 `classifications` 取值
见 `SystemPageClassification`；不在白名单内的 classification 加载
时会被静默丢弃。

| 字段                      | 用于 `before-edit` / `impact` 中填充       |
| ------------------------- | ------------------------------------------ |
| `classifications`         | 决定本页面对哪些目标分类生效。              |
| `knownConstraints`        | "### Known Constraints" 段落的条目。       |
| `doNotEditTargets`        | "### Do Not Edit Directly" 段落的条目。    |
| `affectedChain`           | "### Affected Chains" 段落的内容。         |
| `sourceOfTruth`           | "### Source Of Truth" 段落的条目。         |
| `recommendedVerification` | "### Recommended Verification" 段落的条目。|
| `tags`                    | 内化为 RULE 节点时附加的 free-form 标签。   |

**没有 `classifications`** 的页面会作为全局 overlay：它的
`recommendedVerification` 会附加到每一份 `before-edit` 报告。其他
metadata 字段在全局页上会被忽略，避免淹没针对性指引。

## 第三层 — 项目自定义页

源：`<project-root>/.mindstrate/system-pages/*.json`。

每个页面一个 JSON 文件。结构等同于第二层中的一条
`RuleSystemPagePreset` 条目（不需要 locale 包装）：

```json
{
  "key": "10-combat",
  "name": "10-combat.md",
  "title": "战斗系统",
  "body": ["## 用途", "", "- 权威战斗层。"],
  "overlays": [],
  "userNotesPlaceholder": "- 在这里补充战斗相关的修正。",
  "userNotesTitle": "用户笔记",
  "overlayTitle": "结构化 Overlay",
  "metadata": {
    "classifications": ["combat-system"],
    "knownConstraints": ["GAS 属性集是生成的；不要手工编辑。"]
  }
}
```

同 key 下，自定义页永远胜过第一层和第二层。CLI 助手
`mindstrate system-pages init <key>` 会帮你生成模板（包含注释和
`_help` 块），不用记 schema。

`<project-root>/.mindstrate/system-pages/` 目录本身随项目一起版本化
（提交到仓库），团队成员共享同一份自定义页。

## 实操示例 — 新增一个 stack preset

假设你维护一个 Rust crate，希望所有打开它的 Mindstrate 用户都拿到
一份 Cargo / wasm / no_std 风味的架构页。

1. **写 include 文件**，放在现有检测规则旁边：

   `packages/server/src/project/rules/rust-architecture-pages.json`

   ```json
   {
     "en": [
       {
         "key": "00-overview",
         "name": "00-overview.md",
         "title": "${project.name} Architecture Overview",
         "body": [
           "## Purpose",
           "",
           "- Crate entry point for human readers.",
           "- Framework: ${project.framework}.",
           "- Primary language: ${project.language}."
         ],
         "overlays": [],
         "userNotesPlaceholder": "- Confirm crate ownership here.",
         "userNotesTitle": "User Notes",
         "overlayTitle": "Structured Overlay"
       },
       {
         "key": "10-cargo-features",
         "name": "10-cargo-features.md",
         "title": "Cargo Features and Targets",
         "body": [
           "## Features",
           "",
           "- 在这里记录 feature flag。",
           "",
           "## Targets",
           "",
           "- 在这里记录支持的 `--target` triple。"
         ],
         "overlays": [],
         "userNotesPlaceholder": "- 在这里确认启用的 feature。",
         "userNotesTitle": "用户笔记",
         "overlayTitle": "结构化 Overlay",
         "metadata": {
           "classifications": ["build-module"],
           "knownConstraints": [
             "新增 feature 需要同步更新下游消费方的 Cargo.toml。"
           ]
         }
       }
     ],
     "zh": [ /* 与 en 对齐的中文条目 */ ]
   }
   ```

2. **在规则中引用它**（如 `rust-project.json`）：

   ```json
   { "id": "rust-project", "systemPagesInclude": "rust-architecture-pages.json", ... }
   ```

3. **在任意 Rust 项目里运行 `mindstrate setup`**。骨架的
   `00-overview` 会被规则版本替换；`10-cargo-features.md` 作为
   全新页面出现。

## 实操示例 — 在你的项目中覆盖单页 Unreal

你的 Unreal 项目有一份与内置不同的 `02-cpp-typescript-bridge` 契约。

```bash
mkdir -p .mindstrate/system-pages
cat > .mindstrate/system-pages/02-cpp-typescript-bridge.json <<'JSON'
{
  "key": "02-cpp-typescript-bridge",
  "name": "02-cpp-typescript-桥接.md",
  "title": "C++ <-> TS 桥接（项目专属）",
  "body": [
    "## Source Of Truth",
    "",
    "- 永远编辑 `Source/MyGame/Public/Reflect/*.h`；不要改生成的 `.ts`。"
  ],
  "overlays": [],
  "userNotesPlaceholder": "- 在这里补充 per-feature 覆盖。",
  "userNotesTitle": "用户笔记",
  "overlayTitle": "结构化 Overlay",
  "metadata": {
    "classifications": ["native-script-binding"],
    "knownConstraints": [
      "MyGame 的反射在 Public/Reflect/ 下。"
    ]
  }
}
JSON
```

重新跑 `mindstrate setup`，这一页只在本项目里替换 Unreal preset 的
默认 `02-cpp-typescript-bridge.md`，其他项目仍用标准版本。

## 检查当前生效的页面

```bash
# 列出某个项目会拿到的全部架构页，按来源层分组。
mindstrate system-pages list

# 用规则建议的 key 生成一份自定义页模板。
mindstrate system-pages init 10-combat
```

`list` 输出会以 `[skeleton]`、`[rule:<rule-id>]`、
`[custom:<filename>]` 标记每条来源，便于一眼看到哪一页覆盖了哪一页。

## 内化为 ECS 图节点

经过三层合并后留下的每一页都会被内化为一个确定性的
`RULE + ARCHITECTURE` 节点，id 为
`architecture:system-page:<project>:<page-key>`。节点的 metadata
镜像页面 `metadata` 块——MCP 检索因此不需要解析 Markdown 也能
召回页面级约束。

`setup` / `graph sync` 自动完成这一步。映射细节见
`internalize-system-pages.ts`。
