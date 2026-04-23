/** English translations */
const en = {
  // Navigation
  nav: {
    dashboard: 'Dashboard',
    knowledge: 'Knowledge',
    search: 'Search',
    add: 'Add',
  },

  // Knowledge types
  types: {
    bug_fix: 'Bug Fix',
    best_practice: 'Best Practice',
    architecture: 'Architecture',
    convention: 'Convention',
    pattern: 'Pattern',
    troubleshooting: 'Troubleshooting',
    gotcha: 'Gotcha',
    how_to: 'How-To',
    workflow: 'Workflow',
  } as Record<string, string>,

  // Knowledge statuses
  statuses: {
    probation: 'Probation',
    active: 'Active',
    verified: 'Verified',
    deprecated: 'Deprecated',
    outdated: 'Outdated',
  } as Record<string, string>,

  // Type filter options (with "All Types")
  typeFilter: {
    all: 'All Types',
  },

  // Dashboard
  dashboard: {
    title: 'Dashboard',
    description: 'Mindstrate knowledge base overview',
    totalKnowledge: 'Total Knowledge',
    vectorIndex: 'Vector Index',
    languages: 'Languages',
    typesCount: 'Types',
    byType: 'By Type',
    byStatus: 'By Status',
    byLanguage: 'By Language',
    noData: 'No data',
    recentKnowledge: 'Recent Knowledge',
    viewAll: 'View all',
    noEntries: 'No knowledge entries yet.',
    addFirst: 'Add your first entry',
  },

  // Search page
  search: {
    title: 'Search Knowledge',
    placeholder: "Describe the problem or topic you're looking for...",
    searching: 'Searching...',
    searchBtn: 'Search',
    langPlaceholder: 'Language filter',
    noResults: 'No results found for',
    tryDifferent: 'Try different keywords or remove filters.',
    resultsFor: 'results for',
    welcomeTitle: 'Semantic search across your knowledge base',
    welcomeDesc: 'Describe the problem or topic in natural language.',
  },

  // Knowledge list page
  knowledgeList: {
    title: 'Knowledge Base',
    addBtn: '+ Add Knowledge',
    loading: 'Loading...',
    noEntries: 'No entries found.',
    addFirst: 'Add your first entry',
    confirmDelete: 'Delete this entry?',
  },

  // Knowledge detail page
  detail: {
    back: 'Back',
    edit: 'Edit',
    cancel: 'Cancel',
    delete: 'Delete',
    confirmDelete: 'Permanently delete this entry?',
    loading: 'Loading...',
    notFound: 'Not found',
    problemPlaceholder: 'Problem (optional)',
    solutionPlaceholder: 'Solution',
    tagsPlaceholder: 'Tags (comma-separated)',
    saveChanges: 'Save Changes',
    problem: 'Problem',
    solution: 'Solution',
    useful: 'Useful',
    notUseful: 'Not useful',
    score: 'Score',
    used: 'Used',
    times: 'times',
    metadata: 'Metadata',
    id: 'ID',
    author: 'Author',
    source: 'Source',
    created: 'Created',
    updated: 'Updated',
    confidence: 'Confidence',
    language: 'Language',
    framework: 'Framework',
    project: 'Project',
    commit: 'Commit',
  },

  // Add knowledge page
  addKnowledge: {
    title: 'Add Knowledge',
    typeLabel: 'Type',
    titleLabel: 'Title',
    titlePlaceholder: 'Short descriptive title',
    problemLabel: 'Problem',
    optional: 'optional',
    problemPlaceholder: 'What problem does this solve?',
    solutionLabel: 'Solution',
    solutionPlaceholder: 'The solution, knowledge, or best practice',
    tagsLabel: 'Tags',
    commaSeparated: 'comma-separated',
    tagsPlaceholder: 'react, hooks, typescript',
    languageLabel: 'Language',
    frameworkLabel: 'Framework',
    projectLabel: 'Project',
    authorLabel: 'Author',
    adding: 'Adding...',
    addBtn: 'Add Knowledge',
    required: '*',
    titleSolutionRequired: 'Title and solution are required.',
    addFailed: 'Failed to add knowledge.',
    networkError: 'Network error.',
  },

  // Knowledge card
  card: {
    problem: 'Problem:',
    match: 'match',
    score: 'Score:',
    used: 'Used:',
    upvote: 'Upvote',
    downvote: 'Downvote',
    deleteTitle: 'Delete',
    deleteText: 'Del',
  },
};

export default en;
export type Translations = typeof en;
