/** Chinese translations */
import type { Translations } from './en';

const zh: Translations = {
  // Navigation
  nav: {
    dashboard: '仪表盘',
    knowledge: '知识库',
    search: '搜索',
    add: '添加',
  },

  // Knowledge types
  types: {
    bug_fix: '错误修复',
    best_practice: '最佳实践',
    architecture: '架构决策',
    convention: '项目约定',
    pattern: '设计模式',
    troubleshooting: '故障排查',
    gotcha: '踩坑记录',
    how_to: '操作指南',
    workflow: '工作流程',
  },

  // Knowledge statuses
  statuses: {
    probation: '试用期',
    active: '活跃',
    verified: '已验证',
    deprecated: '已废弃',
    outdated: '已过期',
  },

  // Type filter options
  typeFilter: {
    all: '所有类型',
  },

  // Dashboard
  dashboard: {
    title: '仪表盘',
    description: 'Mindstrate 知识库概览',
    totalKnowledge: '知识总数',
    vectorIndex: '向量索引',
    languages: '编程语言',
    typesCount: '知识类型',
    byType: '按类型',
    byStatus: '按状态',
    byLanguage: '按语言',
    noData: '暂无数据',
    recentKnowledge: '最近添加',
    viewAll: '查看全部',
    noEntries: '还没有知识条目。',
    addFirst: '添加第一条',
  },

  // Search page
  search: {
    title: '搜索知识',
    placeholder: '描述你要查找的问题或主题...',
    searching: '搜索中...',
    searchBtn: '搜索',
    langPlaceholder: '语言筛选',
    noResults: '未找到相关结果：',
    tryDifferent: '尝试不同的关键词或移除筛选条件。',
    resultsFor: '条结果，关键词：',
    welcomeTitle: '在知识库中进行语义搜索',
    welcomeDesc: '用自然语言描述你遇到的问题或感兴趣的主题。',
  },

  // Knowledge list page
  knowledgeList: {
    title: '知识库',
    addBtn: '+ 添加知识',
    loading: '加载中...',
    noEntries: '没有找到条目。',
    addFirst: '添加第一条',
    confirmDelete: '确定删除这条知识？',
  },

  // Knowledge detail page
  detail: {
    back: '返回',
    edit: '编辑',
    cancel: '取消',
    delete: '删除',
    confirmDelete: '确定永久删除这条知识？',
    loading: '加载中...',
    notFound: '未找到',
    problemPlaceholder: '问题描述（可选）',
    solutionPlaceholder: '解决方案',
    tagsPlaceholder: '标签（逗号分隔）',
    saveChanges: '保存修改',
    problem: '问题',
    solution: '解决方案',
    useful: '有用',
    notUseful: '没用',
    score: '分数',
    used: '使用',
    times: '次',
    metadata: '元数据',
    id: 'ID',
    author: '作者',
    source: '来源',
    created: '创建时间',
    updated: '更新时间',
    confidence: '置信度',
    language: '编程语言',
    framework: '框架',
    project: '项目',
    commit: '提交',
  },

  // Add knowledge page
  addKnowledge: {
    title: '添加知识',
    typeLabel: '类型',
    titleLabel: '标题',
    titlePlaceholder: '简短的描述性标题',
    problemLabel: '问题',
    optional: '可选',
    problemPlaceholder: '这条知识解决什么问题？',
    solutionLabel: '解决方案',
    solutionPlaceholder: '解决方案、知识或最佳实践',
    tagsLabel: '标签',
    commaSeparated: '逗号分隔',
    tagsPlaceholder: 'react, hooks, typescript',
    languageLabel: '编程语言',
    frameworkLabel: '框架',
    projectLabel: '项目',
    authorLabel: '作者',
    adding: '添加中...',
    addBtn: '添加知识',
    required: '*',
    titleSolutionRequired: '标题和解决方案为必填项。',
    addFailed: '添加知识失败。',
    networkError: '网络错误。',
  },

  // Knowledge card
  card: {
    problem: '问题：',
    match: '匹配',
    score: '分数：',
    used: '使用：',
    upvote: '有用',
    downvote: '没用',
    deleteTitle: '删除',
    deleteText: '删除',
  },
};

export default zh;
