import React from 'react';
import { RiFolderLine, RiAddLine, RiChat3Line, RiTimeLine } from '@remixicon/react';
import { useProjectsStore } from '@/stores/useProjectsStore';
import { useUIStore } from '@/stores/useUIStore';
import { useSessionUIStore } from '@/sync/session-ui-store';
import { useAllLiveSessions } from '@/sync/sync-context';
import { cn } from '@/lib/utils';

function formatPath(path: string): string {
  const home = '/home/';
  const idx = path.indexOf(home);
  if (idx >= 0) return '~/' + path.slice(idx + home.length).replace(/^[^/]+\//, '');
  return path;
}

function formatRelative(ts: number | undefined): string {
  if (!ts) return 'Never';
  const diff = Date.now() - ts;
  if (diff < 60000) return 'Just now';
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
  return `${Math.floor(diff / 86400000)}d ago`;
}

export const ProjectsView: React.FC = () => {
  const projects = useProjectsStore((s) => s.projects);
  const activeProjectId = useProjectsStore((s) => s.activeProjectId);
  const setActiveProject = useProjectsStore((s) => s.setActiveProject);
  const setActiveView = useUIStore((s) => s.setActiveView);
  const setActiveMainTab = useUIStore((s) => s.setActiveMainTab);
  const openNewSessionDraft = useSessionUIStore((s) => s.openNewSessionDraft);
  const rawLiveSessions = useAllLiveSessions();
  const liveSessions = React.useMemo(() => rawLiveSessions ?? [], [rawLiveSessions]);

  const projectSessionCounts = React.useMemo(() => {
    const counts = new Map<string, number>();
    for (const project of projects) {
      const norm = project.path.replace(/\/+$/, '').replace(/\\/g, '/');
      let count = 0;
      for (const session of liveSessions) {
        const dir = (session.directory ?? '').replace(/\/+$/, '').replace(/\\/g, '/');
        if (dir === norm || dir.startsWith(norm + '/')) count++;
      }
      counts.set(project.id, count);
    }
    return counts;
  }, [projects, liveSessions]);

  const handleOpenProject = (projectId: string) => {
    setActiveProject(projectId);
    setActiveView('chat');
    setActiveMainTab('chat');
  };

  const handleNewSession = (projectPath: string) => {
    setActiveView('chat');
    openNewSessionDraft({ directoryOverride: projectPath });
  };

  return (
    <div className="h-full overflow-auto bg-background">
      <div className="mx-auto w-full max-w-4xl px-4 py-6 md:px-8">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <RiFolderLine className="size-5 text-foreground" />
            <h1 className="text-lg font-semibold text-foreground">Projects</h1>
          </div>
          <span className="text-xs text-muted-foreground">{projects.length} projects · {liveSessions.length} sessions</span>
        </div>

        <p className="mt-1 text-sm text-muted-foreground">
          Your registered project workspaces. Click to open, or start a new session.
        </p>

        {projects.length === 0 ? (
          <div className="mt-8 flex flex-col items-center gap-3 rounded-lg border border-dashed border-border p-10 text-center">
            <RiFolderLine className="size-10 text-muted-foreground" />
            <div className="text-sm font-medium text-foreground">No projects registered</div>
            <p className="text-xs text-muted-foreground">
              Projects are added when you open a directory. Use Chat+Code to start working.
            </p>
            <button
              type="button"
              onClick={() => { setActiveView('chat'); setActiveMainTab('chat'); }}
              className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
            >
              Open Chat
            </button>
          </div>
        ) : (
          <div className="mt-6 grid grid-cols-1 gap-3 md:grid-cols-2">
            {projects.map((project) => {
              const isActive = project.id === activeProjectId;
              const sessionCount = projectSessionCounts.get(project.id) ?? 0;

              return (
                <div
                  key={project.id}
                  className={cn(
                    'group rounded-lg border bg-[var(--surface-elevated)] p-4 transition-colors',
                    isActive ? 'border-primary/40 bg-primary/5' : 'border-border hover:border-primary/20',
                  )}
                >
                  <div className="flex items-start justify-between gap-3">
                    <button
                      type="button"
                      onClick={() => handleOpenProject(project.id)}
                      className="min-w-0 flex-1 text-left"
                    >
                      <div className="flex items-center gap-2">
                        {project.icon ? (
                          <span className="text-lg">{project.icon}</span>
                        ) : (
                          <RiFolderLine className="size-4 text-muted-foreground shrink-0" />
                        )}
                        <span className="truncate font-medium text-sm text-foreground">
                          {project.label || project.path.split('/').pop() || project.path}
                        </span>
                        {isActive && (
                          <span className="shrink-0 rounded-full bg-primary/20 px-1.5 py-0.5 text-[9px] font-medium text-primary">Active</span>
                        )}
                      </div>
                      <div className="mt-1 truncate text-xs text-muted-foreground">{formatPath(project.path)}</div>
                    </button>

                    <button
                      type="button"
                      onClick={() => handleNewSession(project.path)}
                      className="shrink-0 rounded-md bg-primary/10 p-1.5 text-primary hover:bg-primary/20 transition-colors"
                      title="New session in this project"
                    >
                      <RiAddLine className="size-3.5" />
                    </button>
                  </div>

                  <div className="mt-3 flex items-center gap-4 text-xs text-muted-foreground">
                    <div className="flex items-center gap-1">
                      <RiChat3Line className="size-3" />
                      <span>{sessionCount} session{sessionCount !== 1 ? 's' : ''}</span>
                    </div>
                    <div className="flex items-center gap-1">
                      <RiTimeLine className="size-3" />
                      <span>{formatRelative(project.lastOpenedAt)}</span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};
