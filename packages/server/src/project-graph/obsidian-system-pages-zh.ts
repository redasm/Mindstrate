import type { DetectedProject } from '../project/index.js';
import { renderProjectOperationManualSections } from './operation-manual.js';
import type { SystemPageDefinition } from './obsidian-system-page-types.js';

/**
 * 中文 locale 的系统页定义。结构与 `obsidian-system-pages-en.ts` 对齐：
 * 8 页架构手册的中文文案，按 `MINDSTRATE_LOCALE=zh` 时被 dispatch 选用。
 */
export const zhSystemPageDefinitions = (
  project: DetectedProject,
  generatedRoots: string[],
): SystemPageDefinition[] => {
  const validationIntro = '占位命令必须由维护者确认后替换为项目认可的验证命令。';
  const userNotesPlaceholder = '- 在这里补充项目确认、修正或待确认问题。';
  const userNotesTitle = '用户笔记';
  const overlayTitle = '结构化 Overlay';
  return [
    {
      key: '00-overview',
      name: '00-总览.md',
      title: `${project.name} 架构总览`,
      body: [
        '## 目的',
        '',
        '- 面向人的高价值项目架构入口。浏览原始图节点前先阅读这里。',
        `- 框架：${project.framework ?? 'unknown'}。`,
        `- 主要语言：${project.language ?? 'unknown'}。`,
        '',
        '## 主要区域',
        '',
        '- Source：C++ 运行时或应用模块。',
        '- Plugins：项目插件、第三方扩展、编辑器工具和运行时子系统。',
        '- Config：引擎、插件和游戏配置。',
        '- Content：路径和引用敏感的 Unreal 资产。',
        '',
        '## 编辑规则',
        '',
        '- 非平凡变更前，先查询 `before-edit` 和 `impact`，再编辑具体文件。',
        '',
        ...renderProjectOperationManualSections(project),
      ],
      overlays: [
        '- kind: convention',
        '  content: 规划非平凡编辑时，先阅读系统架构页，再查看原始图节点页。',
      ],
      userNotesPlaceholder,
      userNotesTitle,
      overlayTitle,
      metadata: {
        tags: ['architecture-overview'],
      },
    },
    {
      key: '01-runtime-lifecycle',
      name: '01-运行时生命周期.md',
      title: '运行时生命周期',
      body: [
        '## 流程',
        '',
        '- `.uproject` 定义启用插件和项目级模块可见性。',
        '- `.uplugin` 定义插件模块、模块类型、加载阶段和插件依赖。',
        '- `*.Build.cs` 定义模块级 public/private 依赖。',
        '- 运行时启动会加载兼容的 runtime 模块；编辑器启动还可能加载 editor-only 模块。',
        '',
        '## 编辑前',
        '',
        '- 修改 `.uproject`、`.uplugin` 或 `*.Build.cs` 时，先检查模块依赖方向和 Runtime/Editor 边界。',
      ],
      overlays: [
        '- kind: risk',
        '  target: .uproject',
        '  content: 项目 manifest 变更会影响启用插件和启动行为；编辑前先查询影响面。',
      ],
      userNotesPlaceholder,
      userNotesTitle,
      overlayTitle,
      metadata: {
        classifications: ['project-manifest', 'plugin-manifest', 'build-module'],
        knownConstraints: [
          '项目和插件 manifest 控制启用插件、模块类型和加载阶段，是高影响面变更。',
          'Build.cs 变更可能改变 public/private 模块依赖和 Runtime/Editor 边界。',
        ],
        affectedChain: '.uproject/.uplugin -> 模块声明 -> Build.cs 依赖 -> 模块加载阶段 -> runtime/editor target。',
        recommendedVerification: [
          '验证编辑器/运行时启动后插件集合行为符合预期。',
          '运行受影响 target 的 Unreal build compile。',
        ],
        tags: ['runtime-lifecycle', 'manifest', 'build-module'],
      },
    },
    {
      key: '02-cpp-typescript-bridge',
      name: '02-cpp-typescript-桥接.md',
      title: 'C++ 到 TypeScript 桥接',
      body: [
        '## 变更链路',
        '',
        '- C++ UCLASS/USTRUCT/UENUM/UFUNCTION/UPROPERTY 声明是反射源头。',
        '- UnrealHeaderTool 生成反射元数据。',
        '- UnrealSharp generator 消费反射元数据和配置。',
        '- `TypeScript/Typing` 接收生成的声明。',
        '- TypeScript 业务代码消费这些生成声明。',
        '',
        '## Source Of Truth',
        '',
        '- C++ 反射源和 UnrealSharp generator/configuration。',
        '- 生成的 TypeScript 声明是输出，不是源头。',
      ],
      overlays: [
        '- kind: convention',
        '  target: TypeScript/Typing',
        '  content: TypeScript/Typing 是生成输出。不要手工编辑；应修改 C++ 反射源或 UnrealSharp generator/configuration。',
      ],
      userNotesPlaceholder,
      userNotesTitle,
      overlayTitle,
      metadata: {
        classifications: ['native-script-binding', 'generated-output', 'typescript-consumer'],
        knownConstraints: [
          '生成的 TypeScript 声明必须由 C++ 反射元数据或 generator 配置驱动。',
          '生成输出不是 source of truth；编辑前先识别上游源头。',
        ],
        doNotEditTargets: ['TypeScript/Typing'],
        affectedChain: 'C++ UCLASS/USTRUCT/UENUM/UFUNCTION/UPROPERTY -> UHT 反射 -> UnrealSharp generator -> TypeScript/Typing -> TypeScript consumers。',
        recommendedVerification: [
          '运行 UnrealSharp/类型生成并检查生成声明。',
          '运行 TypeScript 类型检查或项目脚本验证。',
          '运行受影响 target 的 Unreal build compile。',
        ],
        tags: ['cpp-typescript-bridge', 'reflection', 'generated-output'],
      },
    },
    {
      key: '03-plugin-boundaries',
      name: '03-插件边界.md',
      title: '插件和模块边界',
      body: [
        '## 关键边界',
        '',
        '- Runtime 模块不能依赖 editor-only 模块。',
        '- Editor 模块可以在编辑器工具扩展运行时数据时依赖 runtime 模块。',
        '- `.uplugin` 插件依赖和 `*.Build.cs` 模块依赖必须保持一致。',
        '- Public dependencies 会成为消费模块接口面的一部分；private dependencies 应保持实现细节。',
      ],
      overlays: [
        '- kind: risk',
        '  target: *.Build.cs',
        '  content: Build.cs 依赖变更可能破坏 Runtime/Editor 边界。编辑前检查 public/private 依赖方向和 .uplugin 插件依赖。',
        '- kind: risk',
        '  target: *.uplugin',
        '  content: 插件模块类型、加载阶段和依赖变更影响面高；修改后验证 editor/runtime 启动。',
      ],
      userNotesPlaceholder,
      userNotesTitle,
      overlayTitle,
      metadata: {
        classifications: ['build-module', 'plugin-manifest', 'editor-boundary'],
        knownConstraints: [
          'Runtime 模块不能依赖 editor-only 模块。',
          'Build.cs 变更可能改变 public/private 模块依赖和 Runtime/Editor 边界。',
        ],
        doNotEditTargets: [
          'Runtime 模块对 editor 模块的 public 依赖。',
        ],
        affectedChain: '.uplugin 模块声明 -> Build.cs public/private 依赖 -> 模块加载阶段 -> runtime/editor target。',
        recommendedVerification: [
          '验证编辑器/运行时启动后插件集合行为符合预期。',
          '运行受影响 target 的 Unreal build compile。',
        ],
        tags: ['plugin-boundary', 'build-module', 'runtime-editor'],
      },
    },
    {
      key: '04-generated-files',
      name: '04-生成文件.md',
      title: '生成文件和 Source Of Truth',
      body: [
        '## 生成根目录',
        '',
        ...generatedRoots.map((root) => `- ${root}`),
        '',
        '## 规则',
        '',
        '- 如果目标位于生成根目录下，停止编辑并先识别上游 source of truth。',
        '- 生成声明漂移应通过修改源元数据或 generator 行为解决。',
      ],
      overlays: [
        '- kind: convention',
        '  target: generated-roots',
        '  content: Binaries、Intermediate、Saved、DerivedDataCache 和 TypeScript/Typing 是生成或本地输出区域，不要手工编辑。',
      ],
      userNotesPlaceholder,
      userNotesTitle,
      overlayTitle,
      metadata: {
        classifications: ['generated-output'],
        knownConstraints: [
          '生成输出不是 source of truth；编辑前先识别上游源头。',
        ],
        doNotEditTargets: generatedRoots,
        affectedChain: 'Generator 源/配置 -> 生成根目录下的输出 -> 下游消费方。',
        recommendedVerification: [
          '重跑 generator (UnrealSharp/UHT/build) 并检查生成根目录的差异。',
        ],
        tags: ['generated-output', 'do-not-edit'],
      },
    },
    {
      key: '05-validation-playbook',
      name: '05-验证手册.md',
      title: '验证手册',
      body: [
        '## 验证策略',
        '',
        `- ${validationIntro}`,
        '- C++ 源码或 Build.cs 变更：运行受影响 target 的 Unreal build compile。',
        '- C++ 反射或绑定变更：运行 Unreal build、类型生成、生成声明检查和 TS 类型验证。',
        '- `.uproject` 或 `.uplugin` 变更：验证插件依赖一致性和 editor/runtime 启动。',
        '- Config 变更：验证配置加载和读取该配置的子系统。',
        '- Content 路径变更：用 Unreal-aware 工具验证资产引用。',
      ],
      overlays: [
        '- kind: convention',
        '  content: 验证命令必须从受影响链路选择，不能只根据被编辑文件扩展名决定。',
      ],
      userNotesPlaceholder,
      userNotesTitle,
      overlayTitle,
      metadata: {
        recommendedVerification: [
          '验证命令从受影响链路选择 (build / type-gen / 插件启动 / 资产校验 / 配置加载)，不能只根据被编辑文件扩展名决定。',
        ],
        tags: ['validation', 'playbook'],
      },
    },
    {
      key: '06-common-change-playbooks',
      name: '06-常见变更手册.md',
      title: '常见变更手册',
      body: [
        '## 面向 TypeScript 的 C++ 反射 API',
        '',
        '- 编辑前：查询图影响面、检查生成声明、搜索 TS consumers、检查所属 Build.cs。',
        '- 编辑：修改 C++ source/header 或 generator 配置；不要手工编辑 TypeScript/Typing。',
        '- 验证：构建 C++、运行 generator、检查声明、运行 TS 验证。',
        '',
        '## 插件或构建依赖',
        '',
        '- 编辑前：检查 `.uproject`、`.uplugin`、`*.Build.cs`、模块类型、加载阶段和 Runtime/Editor 边界。',
        '- 验证：构建受影响 target，并验证 editor/runtime 启动。',
      ],
      overlays: [
        '- kind: convention',
        '  content: 对已知变更类型，应先按 playbook 执行，而不是只依赖局部文件上下文。',
      ],
      userNotesPlaceholder,
      userNotesTitle,
      overlayTitle,
      metadata: {
        classifications: ['native-script-binding', 'build-module'],
        knownConstraints: [
          '对已知变更类型，应先按 playbook 执行，而不是只依赖局部文件上下文。',
        ],
        affectedChain: '目标变更 -> playbook 步骤列表 -> 验证命令集合。',
        recommendedVerification: [
          '严格按 playbook 顺序执行，不要跳过验证步骤。',
        ],
        tags: ['playbook', 'change-type'],
      },
    },
    {
      key: '07-risky-files',
      name: '07-高风险文件.md',
      title: '高风险文件',
      body: [
        '## 高风险目标',
        '',
        '- `.uproject`：启用插件和项目级启动行为。',
        '- `.uplugin`：模块类型、加载阶段、依赖声明。',
        '- `*.Build.cs`：public/private 模块依赖图。',
        '- `TypeScript/Typing`：生成声明输出。',
        '- `Content/**`：路径敏感的 Unreal 资产和引用。',
        '- `Config/**`：启动和子系统配置。',
      ],
      overlays: [
        '- kind: risk',
        '  content: 高风险目标在编辑前必须做影响面分析并识别 source of truth。',
      ],
      userNotesPlaceholder,
      userNotesTitle,
      overlayTitle,
      metadata: {
        classifications: ['project-manifest', 'plugin-manifest', 'build-module', 'asset-reference-sensitive', 'config-sensitive', 'generated-output'],
        knownConstraints: [
          '高风险目标在编辑前必须做影响面分析并识别 source of truth。',
        ],
        doNotEditTargets: [
          '.uproject（依赖/启动评审通过后再改）',
          '.uplugin（依赖/启动评审通过后再改）',
          '*.Build.cs（Runtime/Editor 边界评审通过后再改）',
          'TypeScript/Typing（生成输出；改上游反射或 generator）',
          'Content/**（路径敏感；用 Unreal-aware rename）',
          'Config/**（子系统敏感；验证配置加载）',
        ],
        recommendedVerification: [
          '编辑高风险目标前，先通过 project graph 跑影响面分析。',
        ],
        tags: ['high-risk', 'impact-required'],
      },
    },
  ];
};
