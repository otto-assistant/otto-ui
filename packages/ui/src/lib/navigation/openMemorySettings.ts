import { useUIStore } from '@/stores/useUIStore';
import { navigateHash } from '@/lib/router/hashRoutes';

/**
 * Open the Settings → Memory page.
 *
 * Memory (MemPalace) lives under Settings now. Any UI surface that
 * previously navigated to the standalone Memory view should use this
 * helper instead.
 */
export function openMemorySettings(): void {
  const state = useUIStore.getState();
  state.setSettingsPage('memory');
  state.setSettingsDialogOpen(true);
  state.setActiveView('settings');
  navigateHash('settings');
}
