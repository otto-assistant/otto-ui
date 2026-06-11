import { useI18n, type I18nKey } from '@/lib/i18n';
import { useOttoEventsStore } from '@/stores/useOttoEventsStore';
import {
  mapOttoWsStatusToConnectionState,
  type ConnectionState,
} from '@/hooks/useOttoSync';

const stateConfig: Record<ConnectionState, { colorVar: string; labelKey: I18nKey }> = {
  connected: { colorVar: 'var(--status-success)', labelKey: 'connectionStatus.connected' },
  reconnecting: { colorVar: 'var(--status-warning)', labelKey: 'connectionStatus.reconnecting' },
  disconnected: { colorVar: 'var(--status-error)', labelKey: 'connectionStatus.disconnected' },
};

export function ConnectionStatus() {
  const { t } = useI18n();
  const wsStatus = useOttoEventsStore((state) => state.connectionStatus);
  const { colorVar, labelKey } = stateConfig[mapOttoWsStatusToConnectionState(wsStatus)];

  return (
    <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
      <span
        className="inline-block h-2 w-2 rounded-full"
        style={{ backgroundColor: colorVar }}
      />
      <span>{t(labelKey)}</span>
    </div>
  );
}
