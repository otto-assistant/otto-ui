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

  // Tracks the project path + input branch we last resolved against, per project.
  // Used to resolve `getRootBranch` only for projects that are new or whose
  // input actually changed — rather than re-resolving every project whenever
  // any single project's branch settles (the old N² cascade).
  const resolvedInputKeyByProjectId = React.useRef<Map<string, string>>(new Map());

  React.useEffect(() => {
    if (visibleProjects.length === 0) return;
    let cancelled = false;

    // Debounce so the initial burst of per-project `ensureStatus` updates
    // settles into a single resolution pass instead of one pass per project.
    const timer = setTimeout(() => {
      const run = async () => {
        const validIds = new Set(normalizedProjects.map((project) => project.id));
        // Drop bookkeeping for projects that are no longer present.
        for (const id of resolvedInputKeyByProjectId.current.keys()) {
          if (!validIds.has(id)) {
            resolvedInputKeyByProjectId.current.delete(id);
          }
        }

        const pending = normalizedProjects.filter((project) => {
          const status = gitRepoStatus.get(project.normalizedPath);
          if (status?.isGitRepo === false) {
            resolvedInputKeyByProjectId.current.delete(project.id);
            return false;
          }
          if (status?.isGitRepo !== true || status.branch === null) {
            return false;
          }
          const currentBranch = status.branch.trim();
          const currentInputKey = `${project.normalizedPath}\0${currentBranch}`;
          const lastInputKey = resolvedInputKeyByProjectId.current.get(project.id);
          return lastInputKey === undefined || lastInputKey !== currentInputKey;
        });

        if (pending.length === 0) {
          return;
        }

        const entries = await mapWithConcurrency(pending, 2, async (project) => {
          const inputBranch = gitRepoStatus.get(project.normalizedPath)?.branch?.trim() ?? '';
          const inputKey = `${project.normalizedPath}\0${inputBranch}`;
          const branch = await getRootBranch(
            project.normalizedPath,
            inputBranch ? { knownBranch: inputBranch } : undefined,
          ).catch(() => null);
          return { id: project.id, inputKey, branch };
        });
        if (cancelled) {
          return;
        }

        const resolved = entries.filter((entry) => entry.branch);
        if (resolved.length === 0) {
          return;
        }

        setProjectRootBranches((prev) => {
          const next = new Map(prev);
          resolved.forEach(({ id, branch }) => {
            if (branch) {
              next.set(id, branch);
            }
          });
          return next;
        });
        resolved.forEach(({ id, inputKey }) => {
          resolvedInputKeyByProjectId.current.set(id, inputKey);
        });
      };
      void run();
    }, 150);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [normalizedProjects, projectGitBranchesKey, gitRepoStatus, setProjectRootBranches]);
};
