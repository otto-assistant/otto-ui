import type { ConnectionState } from '../../lib/otto-sync';
import { useOttoSync } from '../../hooks/useOttoSync';

const stateConfig: Record<ConnectionState, { color: string; label: string }> = {
  connected: { color: 'bg-green-500', label: 'Connected' },
  reconnecting: { color: 'bg-yellow-500', label: 'Reconnecting' },
  disconnected: { color: 'bg-red-500', label: 'Disconnected' },
};

export function ConnectionStatus() {
  const { connectionState } = useOttoSync();
  const { color, label } = stateConfig[connectionState];

  return (
    <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
      <span className={`inline-block h-2 w-2 rounded-full ${color}`} />
      <span>{label}</span>
    </div>
  );
}
