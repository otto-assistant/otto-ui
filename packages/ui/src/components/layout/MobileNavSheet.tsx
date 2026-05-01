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
import type { AppActiveView } from '@/constants/agentNav';

type NavItem = {
  id: AppActiveView;
  label: string;
  icon: RemixiconComponentType;
};

const NAV_GROUPS: { title: string; items: NavItem[] }[] = [
  {
    title: 'Main',
    items: [
      { id: 'dashboard', label: 'Dashboard', icon: RiDashboardLine },
      { id: 'chat', label: 'Chat + Code', icon: RiChat3Line },
      { id: 'tasks', label: 'Tasks', icon: RiTaskLine },
    ],
  },
  {
    title: 'Tools',
    items: [
      { id: 'projects', label: 'Projects', icon: RiFolderLine },
      { id: 'persona', label: 'Persona', icon: RiUserSettingsLine },
      { id: 'memory', label: 'Memory', icon: RiBrainLine },
      { id: 'schedule', label: 'Schedule', icon: RiCalendarLine },
    ],
  },
  {
    title: 'Settings',
    items: [
      { id: 'settings', label: 'Settings', icon: RiSettings3Line },
    ],
  },
];

type Props = {
  open: boolean;
  onClose: () => void;
};

export const MobileNavSheet: React.FC<Props> = ({ open, onClose }) => {
  const activeView = useUIStore((state) => state.activeView);
  const setActiveView = useUIStore((state) => state.setActiveView);
  const setSettingsDialogOpen = useUIStore((state) => state.setSettingsDialogOpen);
  const sheetRef = React.useRef<HTMLDivElement>(null);
  const startYRef = React.useRef(0);

  const handleNavigate = (id: AppActiveView) => {
    setActiveView(id);
    if (id === 'settings') {
      setSettingsDialogOpen(true);
    }
    onClose();
  };

  const handleTouchStart = (e: React.TouchEvent) => {
    startYRef.current = e.touches[0].clientY;
  };

  const handleTouchEnd = (e: React.TouchEvent) => {
    const deltaY = e.changedTouches[0].clientY - startYRef.current;
    if (deltaY > 80) {
      onClose();
    }
  };

  if (!open) return null;

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-[60] bg-black/50 animate-in fade-in duration-200"
        onClick={onClose}
        aria-hidden
      />
      {/* Sheet */}
      <div
        ref={sheetRef}
        role="dialog"
        aria-label="Navigation"
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
        className={cn(
          'fixed bottom-0 left-0 right-0 z-[61] max-h-[85dvh] overflow-y-auto rounded-t-2xl bg-background shadow-xl',
          'animate-in slide-in-from-bottom duration-300',
        )}
        style={{ paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 16px)' }}
      >
        {/* Drag handle */}
        <div className="flex justify-center py-3">
          <div className="h-1 w-10 rounded-full bg-muted-foreground/30" />
        </div>

        <div className="px-4 pb-4 space-y-4">
          {NAV_GROUPS.map((group) => (
            <div key={group.title}>
              <h3 className="mb-1 px-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                {group.title}
              </h3>
              <div className="space-y-0.5">
                {group.items.map((item) => {
                  const Icon = item.icon;
                  const isActive = activeView === item.id;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => handleNavigate(item.id)}
                      className={cn(
                        'flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-colors',
                        isActive
                          ? 'bg-primary/10 text-primary'
                          : 'text-foreground hover:bg-muted',
                      )}
                    >
                      <Icon className="h-5 w-5 shrink-0" aria-hidden />
                      <span className="text-sm font-medium">{item.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </div>
    </>
  );
};
