import React from 'react';
import {
  RiBrainLine,
  RiChat3Line,
  RiDashboardLine,
  RiMoreLine,
  RiTaskLine,
} from '@remixicon/react';
import { cn } from '@/lib/utils';
import { useUIStore } from '@/stores/useUIStore';
import type { AppActiveView } from '@/constants/agentNav';
import type { RemixiconComponentType } from '@remixicon/react';

type TabItem = {
  id: AppActiveView | 'more';
  label: string;
  icon: RemixiconComponentType;
};

const TAB_ITEMS: TabItem[] = [
  { id: 'dashboard', label: 'Home', icon: RiDashboardLine },
  { id: 'tasks', label: 'Tasks', icon: RiTaskLine },
  { id: 'chat', label: 'Chat', icon: RiChat3Line },
  { id: 'memory', label: 'Memory', icon: RiBrainLine },
  { id: 'more', label: 'More', icon: RiMoreLine },
];

type Props = {
  onMorePress: () => void;
};

export const MobileTabBar: React.FC<Props> = ({ onMorePress }) => {
  const activeView = useUIStore((state) => state.activeView);
  const setActiveView = useUIStore((state) => state.setActiveView);

  const handlePress = (item: TabItem) => {
    if (item.id === 'more') {
      onMorePress();
      return;
    }
    setActiveView(item.id as AppActiveView);
  };

  return (
    <nav
      aria-label="Mobile navigation"
      className="fixed bottom-0 left-0 right-0 z-50 flex items-center justify-around border-t border-border bg-background/95 backdrop-blur-sm"
      style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)', height: '56px' }}
    >
      {TAB_ITEMS.map((item) => {
        const Icon = item.icon;
        const isActive = item.id !== 'more' && activeView === item.id;

        return (
          <button
            key={item.id}
            type="button"
            onClick={() => handlePress(item)}
            className={cn(
              'flex flex-1 flex-col items-center justify-center gap-0.5 py-1 transition-colors',
              isActive ? 'text-primary' : 'text-muted-foreground',
            )}
          >
            <Icon className="h-5 w-5" aria-hidden />
            <span className="text-[10px] font-medium leading-tight">{item.label}</span>
          </button>
        );
      })}
    </nav>
  );
};
