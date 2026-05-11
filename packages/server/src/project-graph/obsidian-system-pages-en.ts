import type { DetectedProject } from '../project/index.js';
import { renderProjectOperationManualSections } from './operation-manual.js';
import type { SystemPageDefinition } from './obsidian-system-page-types.js';

/**
 * English-locale system page definitions for the Obsidian project graph
 * projection. Pure data assembly: takes a detected project and the project's
 * generated-output roots, produces the canonical 8-page architecture book.
 */
export const enSystemPageDefinitions = (
  project: DetectedProject,
  generatedRoots: string[],
): SystemPageDefinition[] => {
  const validationIntro = 'Replace placeholder commands with the project-approved command once confirmed by a human maintainer.';
  const userNotesPlaceholder = '- Add project-specific confirmations, corrections, or open questions here.';
  const userNotesTitle = 'User Notes';
  const overlayTitle = 'Structured Overlay';
  return [
    {
      key: '00-overview',
      name: '00-overview.md',
      title: `${project.name} Architecture Overview`,
      body: [
        '## Purpose',
        '',
        '- High-value human entry point for the project architecture. Use this before browsing raw graph nodes.',
        `- Framework: ${project.framework ?? 'unknown'}.`,
        `- Primary language: ${project.language ?? 'unknown'}.`,
        '',
        '## Primary Areas',
        '',
        '- Source: C++ runtime or application modules.',
        '- Plugins: project plugins, third-party extensions, editor tools, and runtime subsystems.',
        '- Config: engine, plugin, and game configuration.',
        '- Content: Unreal assets whose paths may be reference-sensitive.',
        '',
        '## Editing Rule',
        '',
        '- For non-trivial changes, query `before-edit` and `impact` before editing exact files.',
        '',
        ...renderProjectOperationManualSections(project),
      ],
      overlays: [
        '- kind: convention',
        '  content: Use system architecture pages before raw graph node pages when planning non-trivial edits.',
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
      name: '01-runtime-lifecycle.md',
      title: 'Runtime Lifecycle',
      body: [
        '## Flow',
        '',
        '- `.uproject` defines enabled plugins and project-level module visibility.',
        '- `.uplugin` files define plugin modules, module type, loading phase, and plugin dependencies.',
        '- `*.Build.cs` files define module-level public and private dependencies.',
        '- Runtime startup loads compatible runtime modules; editor startup can also load editor-only modules.',
        '',
        '## Before Editing',
        '',
        '- If changing `.uproject`, `.uplugin`, or `*.Build.cs`, inspect module dependency direction and runtime/editor boundaries.',
      ],
      overlays: [
        '- kind: risk',
        '  target: .uproject',
        '  content: Project manifest changes can alter enabled plugins and startup behavior; query impact before editing.',
      ],
      userNotesPlaceholder,
      userNotesTitle,
      overlayTitle,
      metadata: {
        classifications: ['project-manifest', 'plugin-manifest', 'build-module'],
        knownConstraints: [
          'Project and plugin manifests control enabled plugins, module type, and load phase; treat them as high-impact changes.',
          'Build.cs changes can alter public/private module dependencies and Runtime/Editor boundaries.',
        ],
        affectedChain: '.uproject/.uplugin -> module declaration -> Build.cs dependencies -> module load phase -> runtime/editor target.',
        sourceOfTruth: [
          '.uproject for project-level enabled plugins and module declarations.',
          '.uplugin for plugin module type, loading phase, and plugin dependency declarations.',
          '*.Build.cs for module-level public/private C++ dependencies.',
        ],
        recommendedVerification: [
          'Validate editor/runtime startup with the changed plugin set.',
          'Unreal build compile for the affected target.',
        ],
        tags: ['runtime-lifecycle', 'manifest', 'build-module'],
      },
    },
    {
      key: '02-cpp-typescript-bridge',
      name: '02-cpp-typescript-bridge.md',
      title: 'C++ To TypeScript Bridge',
      body: [
        '## Change Flow',
        '',
        '- C++ UCLASS/USTRUCT/UENUM/UFUNCTION/UPROPERTY declarations are the reflected source.',
        '- UnrealHeaderTool produces reflection metadata.',
        '- UnrealSharp generator consumes reflection metadata and configuration.',
        '- `TypeScript/Typing` receives generated declarations.',
        '- TypeScript business code consumes generated declarations.',
        '',
        '## Source Of Truth',
        '',
        '- C++ reflection source and UnrealSharp generator/configuration.',
        '- Generated TypeScript declarations are outputs, not source.',
      ],
      overlays: [
        '- kind: convention',
        '  target: TypeScript/Typing',
        '  content: TypeScript/Typing is generated output. Do not edit it manually; edit C++ reflection source or UnrealSharp generator/configuration instead.',
      ],
      userNotesPlaceholder,
      userNotesTitle,
      overlayTitle,
      metadata: {
        classifications: ['native-script-binding', 'generated-output', 'typescript-consumer'],
        knownConstraints: [
          'Generated TypeScript declarations must be driven by C++ reflection metadata or generator configuration.',
          'Generated outputs are not source of truth; identify and edit the upstream source before changing them.',
        ],
        doNotEditTargets: ['TypeScript/Typing'],
        affectedChain: 'C++ UCLASS/USTRUCT/UENUM/UFUNCTION/UPROPERTY -> UHT reflection -> UnrealSharp generator -> TypeScript/Typing -> TypeScript consumers.',
        sourceOfTruth: [
          'C++ reflection source (UCLASS/USTRUCT/UENUM/UFUNCTION/UPROPERTY) and UnrealSharp generator/configuration.',
        ],
        recommendedVerification: [
          'Run UnrealSharp/type generation and inspect generated declarations.',
          'Run TypeScript type check or the project script validation.',
          'Unreal build compile for the affected target.',
        ],
        tags: ['cpp-typescript-bridge', 'reflection', 'generated-output'],
      },
    },
    {
      key: '03-plugin-boundaries',
      name: '03-plugin-boundaries.md',
      title: 'Plugin And Module Boundaries',
      body: [
        '## Critical Boundaries',
        '',
        '- Runtime modules must not depend on editor-only modules.',
        '- Editor modules may depend on runtime modules when the editor tool extends runtime data.',
        '- `.uplugin` plugin dependencies and `*.Build.cs` module dependencies must remain consistent.',
        '- Public dependencies become part of the consuming module surface; private dependencies should stay implementation-only.',
      ],
      overlays: [
        '- kind: risk',
        '  target: *.Build.cs',
        '  content: Build.cs dependency changes can break Runtime/Editor boundaries. Check public/private dependency direction and .uplugin plugin dependencies before editing.',
        '- kind: risk',
        '  target: *.uplugin',
        '  content: Plugin module type, loading phase, and dependency changes are high-impact; validate editor/runtime startup after changing them.',
      ],
      userNotesPlaceholder,
      userNotesTitle,
      overlayTitle,
      metadata: {
        classifications: ['build-module', 'plugin-manifest', 'editor-boundary'],
        knownConstraints: [
          'Runtime modules must not depend on editor-only modules.',
          'Build.cs changes can alter public/private module dependencies and Runtime/Editor boundaries.',
        ],
        doNotEditTargets: [
          'Public dependencies of an editor module from a runtime module.',
        ],
        affectedChain: '.uplugin module declaration -> Build.cs public/private dependencies -> module load phase -> runtime/editor target.',
        sourceOfTruth: [
          '.uplugin module declarations (module type, loading phase, plugin dependencies).',
          'Owning *.Build.cs for the actual public/private C++ dependency surface.',
        ],
        recommendedVerification: [
          'Validate editor/runtime startup with the changed plugin set.',
          'Unreal build compile for the affected target.',
        ],
        tags: ['plugin-boundary', 'build-module', 'runtime-editor'],
      },
    },
    {
      key: '04-generated-files',
      name: '04-generated-files.md',
      title: 'Generated Files And Source Of Truth',
      body: [
        '## Generated Roots',
        '',
        ...generatedRoots.map((root) => `- ${root}`),
        '',
        '## Rule',
        '',
        '- If a target is under a generated root, stop and identify the upstream source of truth before editing.',
        '- Generated declaration drift should be fixed by changing source metadata or generator behavior.',
      ],
      overlays: [
        '- kind: convention',
        '  target: generated-roots',
        '  content: Binaries, Intermediate, Saved, DerivedDataCache, and TypeScript/Typing are generated or local output areas and should not be edited manually.',
      ],
      userNotesPlaceholder,
      userNotesTitle,
      overlayTitle,
      metadata: {
        classifications: ['generated-output'],
        knownConstraints: [
          'Generated outputs are not source of truth; identify and edit the upstream source before changing them.',
        ],
        doNotEditTargets: generatedRoots,
        affectedChain: 'Generator source/config -> generated output under one of the generated roots -> downstream consumers.',
        sourceOfTruth: [
          'The generator source code, configuration, or upstream input that produces files under the generated roots.',
        ],
        recommendedVerification: [
          'Re-run the generator (UnrealSharp/UHT/build) and inspect the diff in the generated root.',
        ],
        tags: ['generated-output', 'do-not-edit'],
      },
    },
    {
      key: '05-validation-playbook',
      name: '05-validation-playbook.md',
      title: 'Validation Playbook',
      body: [
        '## Validation Policy',
        '',
        `- ${validationIntro}`,
        '- C++ source or Build.cs changes: run Unreal build compile for the affected target.',
        '- C++ reflection or binding changes: run Unreal build, type generation, generated declaration inspection, and TS type validation.',
        '- `.uproject` or `.uplugin` changes: validate plugin dependency consistency and editor/runtime startup.',
        '- Config changes: validate config load and the subsystem that reads it.',
        '- Content path changes: validate asset references with Unreal-aware tooling.',
      ],
      overlays: [
        '- kind: convention',
        '  content: Validation commands must be selected from the affected chain, not from the edited file extension alone.',
      ],
      userNotesPlaceholder,
      userNotesTitle,
      overlayTitle,
      metadata: {
        // No specific classification: the validation playbook is a global
        // rule. The internalized RULE node is still valuable for assemble
        // and graph_knowledge_search, just not as a per-classification
        // overlay in task-report.
        recommendedVerification: [
          'Select validation commands from the affected chain (build, type-gen, plugin-startup, asset-validate, config-load), not from the edited file extension.',
        ],
        tags: ['validation', 'playbook'],
      },
    },
    {
      key: '06-common-change-playbooks',
      name: '06-common-change-playbooks.md',
      title: 'Common Change Playbooks',
      body: [
        '## C++ Reflected API For TypeScript',
        '',
        '- Before edit: query graph impact, check generated declaration, search TS consumers, inspect owning Build.cs.',
        '- Edit: change C++ source/header or generator configuration; do not hand-edit TypeScript/Typing.',
        '- Verify: build C++, run generator, inspect declaration, run TS validation.',
        '',
        '## Plugin Or Build Dependency',
        '',
        '- Before edit: inspect `.uproject`, `.uplugin`, `*.Build.cs`, module type, loading phase, and runtime/editor boundary.',
        '- Verify: build affected target and validate editor/runtime startup.',
      ],
      overlays: [
        '- kind: convention',
        '  content: For known change types, follow the playbook before editing rather than relying on local file context only.',
      ],
      userNotesPlaceholder,
      userNotesTitle,
      overlayTitle,
      metadata: {
        classifications: ['native-script-binding', 'build-module'],
        knownConstraints: [
          'For known change types, follow the playbook before editing rather than relying on local file context only.',
        ],
        affectedChain: 'Targeted change -> playbook step list -> verification command set.',
        sourceOfTruth: [
          'The change-type playbook step list (this page) plus the system page that owns the change subject.',
        ],
        recommendedVerification: [
          'Follow the playbook step ordering exactly; do not skip the verification step.',
        ],
        tags: ['playbook', 'change-type'],
      },
    },
    {
      key: '07-risky-files',
      name: '07-risky-files.md',
      title: 'Risky Files',
      body: [
        '## High-Risk Targets',
        '',
        '- `.uproject`: enabled plugins and project-level startup behavior.',
        '- `.uplugin`: module type, loading phase, dependency declarations.',
        '- `*.Build.cs`: public/private module dependency graph.',
        '- `TypeScript/Typing`: generated declaration output.',
        '- `Content/**`: path-sensitive Unreal assets and references.',
        '- `Config/**`: startup and subsystem configuration.',
      ],
      overlays: [
        '- kind: risk',
        '  content: High-risk targets require impact analysis and source-of-truth identification before editing.',
      ],
      userNotesPlaceholder,
      userNotesTitle,
      overlayTitle,
      metadata: {
        classifications: ['project-manifest', 'plugin-manifest', 'build-module', 'asset-reference-sensitive', 'config-sensitive', 'generated-output'],
        knownConstraints: [
          'High-risk targets require impact analysis and source-of-truth identification before editing.',
        ],
        doNotEditTargets: [
          '.uproject (touch only after dependency / startup review)',
          '.uplugin (touch only after dependency / startup review)',
          '*.Build.cs (touch only after Runtime/Editor boundary review)',
          'TypeScript/Typing (generated; edit upstream reflection or generator)',
          'Content/** (path-sensitive; use Unreal-aware rename)',
          'Config/** (subsystem-sensitive; verify config load)',
        ],
        sourceOfTruth: [
          'For each high-risk target, see the matching system page (01 runtime-lifecycle, 02 cpp-typescript-bridge, 03 plugin-boundaries, 04 generated-files).',
        ],
        recommendedVerification: [
          'Before editing a high-risk target, run impact analysis through the project graph.',
        ],
        tags: ['high-risk', 'impact-required'],
      },
    },
  ];
};
