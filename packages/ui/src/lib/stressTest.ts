import { useTasksStore } from '@/stores/useTasksStore';
import { useMemoryStore } from '@/stores/useMemoryStore';
import { useDashboardStore } from '@/stores/useDashboardStore';
import { useProjectsStore } from '@/stores/useProjectsStore';
import { useGlobalSessionsStore } from '@/stores/useGlobalSessionsStore';

const PRIORITIES = ['high', 'medium', 'low'] as const;
const STATUSES = ['pending', 'in_progress', 'done', 'cancelled'] as const;
const OWNERS = ['user', 'agent', 'cron'] as const;
const OWNER_NAMES = ['You', 'Otto', 'Cron', 'Alice', 'Bob'];
const TASK_TITLES = [
  'Review PR', 'Fix CSS layout', 'Update dependencies', 'Write tests', 'Deploy staging',
  'Refactor auth module', 'Add logging', 'Optimize queries', 'Fix memory leak', 'Update docs',
  'Migrate database', 'Add caching', 'Fix race condition', 'Implement search', 'Add pagination',
];
const PROJECT_NAMES = [
  'otto-ui', 'otto-backend', 'otto-cli', 'otto-discord', 'otto-docs',
  'api-gateway', 'auth-service', 'user-service', 'payment-service', 'notification-service',
  'web-app', 'mobile-app', 'admin-panel', 'landing-page', 'blog',
  'ml-pipeline', 'data-warehouse', 'analytics-dashboard', 'monitoring', 'infra-terraform',
];

function pick<T>(arr: readonly T[]): T { return arr[Math.floor(Math.random() * arr.length)]; }
function uid(): string { return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`; }

function generateTasks(count: number) {
  return Array.from({ length: count }, (_, i) => ({
    id: uid(),
    title: `${pick(TASK_TITLES)} #${i + 1}`,
    description: `Stress test task ${i + 1} — auto-generated for performance testing.`,
    priority: pick(PRIORITIES),
    status: pick(STATUSES),
    ownerType: pick(OWNERS),
    ownerName: pick(OWNER_NAMES),
    dueAt: Math.random() > 0.3 ? new Date(Date.now() + Math.random() * 14 * 86400000).toISOString() : null,
    dueDate: null,
    recurrence: 'none' as const,
    lastTriggeredAt: null,
    createdAt: new Date(Date.now() - Math.random() * 30 * 86400000).toISOString(),
    updatedAt: new Date(Date.now() - Math.random() * 7 * 86400000).toISOString(),
    source: 'web' as const,
    history: [{ timestamp: new Date().toISOString(), action: 'Created' }],
  }));
}

function generateMemoryRelations(count: number) {
  const subjects = ['Otto', 'User', 'System', 'Agent', 'Coder', 'Reviewer', 'Planner', 'Manager'];
  const predicates = ['knows', 'prefers', 'uses', 'dislikes', 'manages', 'created', 'reviewed', 'deployed'];
  const objects = ['TypeScript', 'React', 'Vim', 'dark mode', 'tabs', 'spaces', 'TDD', 'monorepos', 'microservices', 'GraphQL', 'REST', 'Docker'];
  return Array.from({ length: count }, (_, i) => ({
    id: `r${Date.now() + i}`,
    subject: `${pick(subjects)}-${Math.floor(i / 10)}`,
    predicate: pick(predicates),
    object: `${pick(objects)}-${i}`,
    validFrom: new Date(Date.now() - Math.random() * 90 * 86400000).toISOString().split('T')[0],
    validTo: Math.random() > 0.7 ? new Date(Date.now() + Math.random() * 90 * 86400000).toISOString().split('T')[0] : undefined,
  }));
}

function generateProjects(count: number) {
  return Array.from({ length: count }, (_, i) => {
    const name = i < PROJECT_NAMES.length ? PROJECT_NAMES[i] : `project-${i + 1}`;
    const path = `/home/ubuntu/projects/${name}`;
    return {
      id: `path_${btoa(path).replace(/[+/=]/g, '_')}`,
      path,
      label: name.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' '),
      icon: ['📦', '🚀', '🔧', '📊', '🌐', '🤖', '📱', '🔒', '💾', '📝'][i % 10],
      color: null,
      iconBackground: null,
      iconImage: null,
      addedAt: Date.now() - Math.random() * 90 * 86400000,
      lastOpenedAt: Date.now() - Math.random() * 7 * 86400000,
      sidebarCollapsed: i > 5,
    };
  });
}

function generateSessions(projects: ReturnType<typeof generateProjects>, sessionsPerProject: number) {
  const sessions: Array<{
    id: string;
    title: string;
    directory: string;
    time: { created: string; updated: string };
    parentID: string | null;
  }> = [];
  const titles = ['Fix bug in auth', 'Implement feature', 'Code review', 'Refactor module', 'Write tests',
    'Deploy to staging', 'Investigate issue', 'Optimize performance', 'Update docs', 'Database migration',
    'API integration', 'UI polish', 'Security audit', 'Dependency update', 'CI/CD setup'];

  for (const project of projects) {
    const count = Math.floor(sessionsPerProject * (0.5 + Math.random()));
    for (let i = 0; i < count; i++) {
      sessions.push({
        id: uid(),
        title: `${pick(titles)} — ${project.label} #${i + 1}`,
        directory: project.path,
        time: {
          created: new Date(Date.now() - Math.random() * 30 * 86400000).toISOString(),
          updated: new Date(Date.now() - Math.random() * 3 * 86400000).toISOString(),
        },
        parentID: null,
      });
    }
  }
  return sessions;
}

export function runStressTest(config: {
  tasks?: number;
  events?: number;
  relations?: number;
  projects?: number;
  sessionsPerProject?: number;
} = {}) {
  const {
    tasks = 2000,
    relations = 3000,
    projects: projectCount = 20,
    sessionsPerProject = 50,
  } = config;

  console.time('[stress] Tasks');
  useTasksStore.setState({ tasks: generateTasks(tasks), _lastFetchedAt: Date.now() });
  console.timeEnd('[stress] Tasks');

  console.time('[stress] Memory');
  useMemoryStore.setState({ relations: generateMemoryRelations(relations), _lastGraphFetch: Date.now() });
  console.timeEnd('[stress] Memory');

  console.time('[stress] Projects');
  const projectList = generateProjects(projectCount);
  useProjectsStore.setState({ projects: projectList });
  console.timeEnd('[stress] Projects');

  console.time('[stress] Sessions');
  const sessionList = generateSessions(projectList, sessionsPerProject);
  useGlobalSessionsStore.setState({
    activeSessions: sessionList as never[],
  });
  console.timeEnd('[stress] Sessions');

  console.time('[stress] Dashboard');
  const dashState = useDashboardStore.getState();
  useDashboardStore.setState({
    ...dashState,
    status: dashState.status ?? { healthy: true, version: 'stress-test' },
    stats: {
      messagesToday: sessionList.length * 3,
      tasksCompleted: Math.floor(tasks * 0.3),
      activeSessions: sessionList.length,
      memoryFacts: relations,
    },
    _lastFetchedAt: Date.now(),
  });
  console.timeEnd('[stress] Dashboard');

  const totalSessions = sessionList.length;
  console.log(`[stress] Injected: ${projectCount} projects, ${totalSessions} sessions, ${tasks} tasks, ${relations} relations`);
}

if (typeof window !== 'undefined') {
  (window as unknown as Record<string, unknown>).__ottoStressTest = runStressTest;
}
