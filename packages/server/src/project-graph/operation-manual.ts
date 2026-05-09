import type { DetectedProject, ProjectOperationManual } from '../project/index.js';
import { resolveProjectGraphLocale, type ProjectGraphLocale } from './project-graph-locale.js';
import { listOrFallback } from './project-graph-report-shared.js';

export interface ProjectGraphTaskGuidance {
  title: string;
  items: string[];
}

const labels = {
  en: {
    architecture: 'Architecture & Lifecycle',
    invariants: 'Critical Invariants',
    conventions: 'Conventions',
    modules: 'Module Responsibility Map',
    flows: 'Cross-System Flows',
    playbooks: 'Change Playbooks',
    validation: 'Validation Commands',
    beforeEdit: 'Before Editing',
    owns: 'Owns',
    doesNotOwn: 'Does not own',
    runtimeImpact: 'Runtime impact',
    generatedOutputs: 'Generated outputs',
    editingRules: 'Editing rules',
    appliesTo: 'Applies to',
    command: 'Command',
    note: 'Note',
    before: 'Before edit',
    edit: 'Edit',
    verify: 'Verify',
    validationSteps: 'Validation',
  },
  zh: {
    architecture: '架构与生命周期',
    invariants: '关键不变量',
    conventions: '约定',
    modules: '模块职责表',
    flows: '跨系统链路',
    playbooks: '修改类型 Playbook',
    validation: '验证命令',
    beforeEdit: '编辑前流程',
    owns: '负责',
    doesNotOwn: '不负责',
    runtimeImpact: '运行时影响',
    generatedOutputs: '生成输出',
    editingRules: '编辑规则',
    appliesTo: '适用于',
    command: '命令',
    note: '说明',
    before: '编辑前',
    edit: '编辑',
    verify: '验证',
    validationSteps: '验证',
  },
} satisfies Record<ProjectGraphLocale, Record<string, string>>;

export const operationManualForProject = (project: DetectedProject): ProjectOperationManual | undefined =>
  project.graphHints?.operationManual;

export const renderProjectOperationManualSections = (project: DetectedProject): string[] => {
  const manual = operationManualForProject(project);
  if (!manual) return [];
  const t = labels[resolveProjectGraphLocale()];
  return compactSections([
    section(t.architecture, manual.architecture),
    section(t.invariants, manual.criticalInvariants),
    section(t.conventions, manual.conventions),
    section(t.beforeEdit, manual.beforeEditWorkflow),
    moduleSection(manual, t),
    flowSection(manual, t),
    playbookSection(manual, t),
    validationSection(manual, t),
  ]);
};

export const taskGuidanceFromOperationManual = (
  project: DetectedProject | undefined,
  task: 'before-edit' | 'impact',
  query: string | undefined,
): ProjectGraphTaskGuidance[] => {
  const manual = project ? operationManualForProject(project) : undefined;
  if (!manual) return [];
  const t = labels[resolveProjectGraphLocale()];
  const relevantModules = (manual.moduleResponsibilities ?? []).filter((entry) => matchesQuery(query, [entry.path, entry.role, ...(entry.editingRules ?? [])]));
  const relevantFlows = (manual.flows ?? []).filter((entry) => matchesQuery(query, [entry.name, ...(entry.appliesTo ?? []), ...entry.steps]));
  const relevantPlaybooks = (manual.playbooks ?? []).filter((entry) => matchesQuery(query, [entry.changeType, ...(entry.appliesTo ?? [])]));
  const relevantValidation = (manual.validationCommands ?? []).filter((entry) => matchesQuery(query, [entry.name, ...(entry.appliesTo ?? []), entry.note ?? '', entry.command ?? '']));

  return [
    ...(task === 'before-edit' ? guidance(t.beforeEdit, manual.beforeEditWorkflow) : []),
    ...guidance(t.invariants, manual.criticalInvariants),
    ...guidance(t.modules, relevantModules.flatMap((entry) => [
      `${entry.path}: ${entry.role}`,
      ...(entry.editingRules ?? []).map((rule) => `${entry.path}: ${rule}`),
    ])),
    ...guidance(t.flows, relevantFlows.flatMap((entry) => [
      entry.name,
      ...entry.steps.map((step) => `${entry.name}: ${step}`),
    ])),
    ...guidance(t.playbooks, relevantPlaybooks.flatMap((entry) => [
      entry.changeType,
      ...(entry.beforeEdit ?? []).map((item) => `${t.before}: ${item}`),
      ...(entry.verify ?? []).map((item) => `${t.verify}: ${item}`),
    ])),
    ...guidance(t.validation, relevantValidation.map((entry) => entry.command
      ? `${entry.name}: ${entry.command}`
      : `${entry.name}: ${entry.note ?? 'maintainer confirmation required'}`)),
  ];
};

const section = (title: string, items: string[] | undefined): string[] => [
  `## ${title}`,
  '',
  ...listOrFallback(items ?? []),
  '',
];

const moduleSection = (manual: ProjectOperationManual, t: Record<string, string>): string[] => {
  const modules = manual.moduleResponsibilities ?? [];
  if (modules.length === 0) return [];
  return [
    `## ${t.modules}`,
    '',
    ...modules.flatMap((entry) => [
      `### ${entry.path}`,
      '',
      `- Role: ${entry.role}`,
      ...prefixedList(t.owns, entry.owns),
      ...prefixedList(t.doesNotOwn, entry.doesNotOwn),
      ...(entry.runtimeImpact ? [`- ${t.runtimeImpact}: ${entry.runtimeImpact}`] : []),
      ...prefixedList(t.generatedOutputs, entry.generatedOutputs),
      ...prefixedList(t.editingRules, entry.editingRules),
      '',
    ]),
  ];
};

const flowSection = (manual: ProjectOperationManual, t: Record<string, string>): string[] => {
  const flows = manual.flows ?? [];
  if (flows.length === 0) return [];
  return [
    `## ${t.flows}`,
    '',
    ...flows.flatMap((flow) => [
      `### ${flow.name}`,
      '',
      ...prefixedList(t.appliesTo, flow.appliesTo),
      ...flow.steps.map((step, index) => `${index + 1}. ${step}`),
      ...prefixedList(t.validationSteps, flow.validation),
      '',
    ]),
  ];
};

const playbookSection = (manual: ProjectOperationManual, t: Record<string, string>): string[] => {
  const playbooks = manual.playbooks ?? [];
  if (playbooks.length === 0) return [];
  return [
    `## ${t.playbooks}`,
    '',
    ...playbooks.flatMap((playbook) => [
      `### ${playbook.changeType}`,
      '',
      ...prefixedList(t.appliesTo, playbook.appliesTo),
      ...prefixedList(t.before, playbook.beforeEdit),
      ...prefixedList(t.edit, playbook.edit),
      ...prefixedList(t.verify, playbook.verify),
      '',
    ]),
  ];
};

const validationSection = (manual: ProjectOperationManual, t: Record<string, string>): string[] => {
  const commands = manual.validationCommands ?? [];
  if (commands.length === 0) return [];
  return [
    `## ${t.validation}`,
    '',
    ...commands.flatMap((command) => [
      `- ${command.name}`,
      ...(command.command ? [`  - ${t.command}: \`${command.command}\``] : []),
      ...(command.note ? [`  - ${t.note}: ${command.note}`] : []),
      ...(command.appliesTo && command.appliesTo.length > 0 ? [`  - ${t.appliesTo}: ${command.appliesTo.join(', ')}`] : []),
    ]),
    '',
  ];
};

const prefixedList = (label: string, values: string[] | undefined): string[] =>
  values && values.length > 0 ? values.map((value) => `- ${label}: ${value}`) : [];

const compactSections = (sections: string[][]): string[] => sections.flatMap((section) => section);

const guidance = (title: string, items: string[] | undefined): ProjectGraphTaskGuidance[] =>
  items && items.length > 0 ? [{ title, items }] : [];

const matchesQuery = (query: string | undefined, values: string[]): boolean => {
  const normalized = query?.trim().toLowerCase();
  if (!normalized) return true;
  return values.some((value) => value.toLowerCase().includes(normalized) || normalized.includes(value.toLowerCase()));
};
