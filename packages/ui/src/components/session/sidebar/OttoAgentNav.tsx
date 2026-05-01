import React from 'react';
import {
  RiBrainLine,
  RiCalendarLine,
  RiChat3Line,
  RiDashboardLine,
  RiFolderLine,
  RiSettings3Line,
  RiTaskLine,
  RiUserSettingsLine,
  type RemixiconComponentType,
} from '@remixicon/react';
import { cn } from '@/lib/utils';
import { useUIStore } from '@/stores/useUIStore';
import { navigateHash } from '@/lib/router/hashRoutes';
import type { AppActiveView } from '@/constants/agentNav';

type NavItem = {
  id: AppActiveView;
  label: string;
  icon: RemixiconComponentType;
};

const NAV_ITEMS: NavItem[] = [
  { id: 'dashboard', label: 'Dashboard', icon: RiDashboardLine },
  { id: 'projects', label: 'Projects', icon: RiFolderLine },
  { id: 'persona', label: 'Persona', icon: RiUserSettingsLine },
  { id: 'memory', label: 'Memory', icon: RiBrainLine },
  { id: 'tasks', label: 'Tasks', icon: RiTaskLine },
  { id: 'schedule', label: 'Schedule', icon: RiCalendarLine },
  { id: 'chat', label: 'Chat+Code', icon: RiChat3Line },
  { id: 'settings', label: 'Settings', icon: RiSettings3Line },
];

type Props = {
  mobileVariant?: boolean;
};

export function OttoAgentNav({ mobileVariant = false }: Props): React.ReactNode {
  const activeView = useUIStore((state) => state.activeView);
  const setSessionSwitcherOpen = useUIStore((state) => state.setSessionSwitcherOpen);
  const setSettingsDialogOpen = useUIStore((state) => state.setSettingsDialogOpen);

  const handleNavigate = React.useCallback(
    (target: AppActiveView) => {
      if (mobileVariant) {
        setSessionSwitcherOpen(false);
      }

      // Use hash-based navigation (updates URL + store)
      navigateHash(target);

      if (target === 'settings') {
        setSettingsDialogOpen(true);
      }
    },
    [mobileVariant, setSessionSwitcherOpen, setSettingsDialogOpen],
  );

  const buttonClasses = (selected: boolean) =>
    cn(
      'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors outline-none border border-transparent',
      'focus-visible:border-primary/35 focus-visible:ring-2 focus-visible:ring-primary/40',
      selected
        ? 'bg-interactive-muted text-foreground'
        : 'text-muted-foreground hover:bg-interactive-hover/60 hover:text-foreground',
    );

  return (
    <nav aria-label="Agent workspace" className="border-b border-border/40 px-2 py-2">
      <div className="grid grid-cols-2 gap-1">
        {NAV_ITEMS.map((item) => {
          const Icon = item.icon;
          const selected = activeView === item.id;

          return (
            <button
              key={item.id}
              type="button"
              onClick={() => handleNavigate(item.id)}
              className={cn(buttonClasses(Boolean(selected)), 'min-w-0')}
            >
              <Icon className={cn('h-4 w-4 shrink-0', selected ? 'text-foreground' : 'text-muted-foreground')} aria-hidden />
              <span className="min-w-0 flex-1 truncate">{item.label}</span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}
