import { useTasksStore } from '@/stores/useTasksStore';
import { useScheduleStore } from '@/stores/useScheduleStore';
import { useMemoryStore } from '@/stores/useMemoryStore';
import { useDashboardStore } from '@/stores/useDashboardStore';

const PRIORITIES = ['high', 'medium', 'low'] as const;
const STATUSES = ['pending', 'in_progress', 'done', 'cancelled'] as const;
const OWNERS = ['user', 'agent', 'cron'] as const;
const OWNER_NAMES = ['You', 'Otto', 'Cron', 'Alice', 'Bob'];
const TASK_TITLES = [
  'Review PR', 'Fix CSS layout', 'Update dependencies', 'Write tests', 'Deploy staging',
  'Refactor auth module', 'Add logging', 'Optimize queries', 'Fix memory leak', 'Update docs',
  'Migrate database', 'Add caching', 'Fix race condition', 'Implement search', 'Add pagination',
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
    dueDate: Math.random() > 0.3 ? new Date(Date.now() + Math.random() * 14 * 86400000).toISOString() : null,
    createdAt: new Date(Date.now() - Math.random() * 30 * 86400000).toISOString(),
    updatedAt: new Date(Date.now() - Math.random() * 7 * 86400000).toISOString(),
    source: 'web' as const,
    history: [{ timestamp: new Date().toISOString(), action: 'Created' }],
  }));
}

function generateScheduleEvents(count: number) {
  return Array.from({ length: count }, (_, i) => ({
    id: uid(),
    title: `Scheduled job #${i + 1}`,
    prompt: `Auto-generated schedule event ${i + 1}`,
    type: (Math.random() > 0.5 ? 'recurring' : 'one-time') as 'recurring' | 'one-time',
    cron: Math.random() > 0.5 ? '0 9 * * 1-5' : undefined,
    datetime: Math.random() > 0.5 ? new Date(Date.now() + Math.random() * 30 * 86400000).toISOString() : undefined,
    status: pick(['active', 'paused', 'completed'] as const),
    createdAt: new Date(Date.now() - Math.random() * 60 * 86400000).toISOString(),
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

export function runStressTest(config: { tasks?: number; events?: number; relations?: number } = {}) {
  const { tasks = 2000, events = 500, relations = 3000 } = config;

  console.time('[stress] Tasks');
  useTasksStore.setState({ tasks: generateTasks(tasks), _lastFetchedAt: Date.now() });
  console.timeEnd('[stress] Tasks');

  console.time('[stress] Schedule');
  useScheduleStore.setState({ events: generateScheduleEvents(events), _lastFetchedAt: Date.now() });
  console.timeEnd('[stress] Schedule');

  console.time('[stress] Memory');
  useMemoryStore.setState({ relations: generateMemoryRelations(relations), _lastGraphFetch: Date.now() });
  console.timeEnd('[stress] Memory');

  console.time('[stress] Dashboard');
  const dashState = useDashboardStore.getState();
  useDashboardStore.setState({
    ...dashState,
    status: dashState.status ?? { healthy: true, version: 'stress-test' },
    stats: { messagesToday: 4200, tasksCompleted: tasks, activeSessions: 150, memoryFacts: relations },
    _lastFetchedAt: Date.now(),
  });
  console.timeEnd('[stress] Dashboard');

  console.log(`[stress] Injected: ${tasks} tasks, ${events} schedule events, ${relations} memory relations`);
}

if (typeof window !== 'undefined') {
  (window as unknown as Record<string, unknown>).__ottoStressTest = runStressTest;
}
