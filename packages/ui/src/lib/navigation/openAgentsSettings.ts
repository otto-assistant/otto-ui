import { useUIStore } from '@/stores/useUIStore';
import { navigateHash } from '@/lib/router/hashRoutes';

/**
 * Open the Settings → Agents page.
 *
 * Persona configuration lives under Settings → Agents now, so any UI surface
 * that previously pointed at the standalone Persona view should use this
 * helper instead.
 */
export function openAgentsSettings(): void {
  const state = useUIStore.getState();
  state.setSettingsPage('agents');
  state.setSettingsDialogOpen(true);
  state.setActiveView('settings');
  navigateHash('settings');
}
