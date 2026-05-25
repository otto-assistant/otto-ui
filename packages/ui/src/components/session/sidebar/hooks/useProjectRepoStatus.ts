import React from 'react';
import { getRootBranch } from '@/lib/worktrees/worktreeStatus';
import { mapWithConcurrency } from '@/lib/concurrency';
import { useGitStore } from '@/stores/useGitStore';
import { useRuntimeAPIs } from '@/hooks/useRuntimeAPIs';

type Project = { id: string; path: string; normalizedPath: string };

type Args = {
  normalizedProjects: Project[];
  gitRepoStatus: Map<string, { isGitRepo: boolean | null; branch: string | null }>;
  setProjectRepoStatus: React.Dispatch<React.SetStateAction<Map<string, boolean | null>>>;
  setProjectRootBranches: React.Dispatch<React.SetStateAction<Map<string, string>>>;
  /**
   * Only projects in this set get an immediate git probe + root-branch
   * fetch. Other projects fall back to a "null" status until the user
   * actually expands them. Without this gate the sidebar would fire
   * 2–4 git exec calls per registered project on every mount — with
   * 50+ projects that's hundreds of failing /api/fs/exec requests
   * (and corresponding server-side path resolution work) before the
   * user has done anything.
   */
  visibleProjectIds: Set<string> | null;
};

export const useProjectRepoStatus = (args: Args): void => {
  const {
    normalizedProjects,
    gitRepoStatus,
    setProjectRepoStatus,
    setProjectRootBranches,
    visibleProjectIds,
  } = args;

  const { git } = useRuntimeAPIs();
  const ensureStatus = useGitStore((state) => state.ensureStatus);

  const visibleProjects = React.useMemo(() => {
    if (!visibleProjectIds || visibleProjectIds.size === 0) {
      return normalizedProjects.slice(0, 0);
    }
    return normalizedProjects.filter((project) => visibleProjectIds.has(project.id));
  }, [normalizedProjects, visibleProjectIds]);

  // Derive repo status from centralized Git store
  React.useEffect(() => {
    if (!git || visibleProjects.length === 0) {
      return;
    }

    // Trigger ensureStatus only for visible projects (the active one
    // plus any whose section the user has expanded). The Git store
    // dedupes inflight + caches per-directory so cheap to re-fire.
    visibleProjects.forEach((project) => {
      void ensureStatus(project.normalizedPath, git);
    });
  }, [visibleProjects, git, ensureStatus]);

  // Read isGitRepo from the store-populated state. We surface a status
  // for *every* project so the icon/UI doesn't flash — projects not
  // yet probed simply report `null` ("unknown") until the user expands.
  React.useEffect(() => {
    const next = new Map<string, boolean | null>();
    normalizedProjects.forEach((project) => {
      next.set(project.id, gitRepoStatus.get(project.normalizedPath)?.isGitRepo ?? null);
    });
    setProjectRepoStatus(next);
  }, [normalizedProjects, gitRepoStatus, setProjectRepoStatus]);

  const projectGitBranchesKey = React.useMemo(() => {
    return visibleProjects
      .map((project) => {
        const branch = gitRepoStatus.get(project.normalizedPath)?.branch ?? '';
        return `${project.id}:${branch}`;
      })
      .join('|');
  }, [visibleProjects, gitRepoStatus]);

  React.useEffect(() => {
    if (visibleProjects.length === 0) return;
    let cancelled = false;
    const run = async () => {
      const entries = await mapWithConcurrency(visibleProjects, 2, async (project) => {
        const branch = await getRootBranch(project.normalizedPath).catch(() => null);
        return { id: project.id, branch };
      });
      if (cancelled) {
        return;
      }
      setProjectRootBranches((prev) => {
        const next = new Map(prev);
        entries.forEach(({ id, branch }) => {
          if (branch) {
            next.set(id, branch);
          }
        });
        return next;
      });
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [visibleProjects, projectGitBranchesKey, setProjectRootBranches]);
};
