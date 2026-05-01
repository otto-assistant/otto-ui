import * as React from 'react';

import { Checkbox } from '@/components/ui/checkbox';
import { getDesktopAutostartEnabled, setDesktopAutostartEnabled } from '@/lib/desktopNative';
import { isDesktopShell, isTauriShell } from '@/lib/desktop';
import { useI18n } from '@/lib/i18n';

export const DesktopAutostartSettings: React.FC = () => {
  const { t } = useI18n();
  const visible = React.useMemo(() => isDesktopShell() && isTauriShell(), []);
  const [value, setValue] = React.useState(false);
  const [isLoading, setIsLoading] = React.useState(true);
  const [isSaving, setIsSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!visible) {
      setIsLoading(false);
      return;
    }

    let cancelled = false;

    void (async () => {
      try {
        const enabled = await getDesktopAutostartEnabled();
        if (cancelled) {
          return;
        }
        if (enabled !== null) {
          setValue(enabled);
          setError(null);
        } else {
          setError(t('settings.openchamber.desktopAutostart.error.loadFailed'));
        }
      } catch {
        if (!cancelled) {
          setError(t('settings.openchamber.desktopAutostart.error.loadFailed'));
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [t, visible]);

  const applyNext = React.useCallback(
    async (next: boolean) => {
      if (!visible || isLoading || isSaving) {
        return;
      }

      setIsSaving(true);
      setError(null);

      try {
        await setDesktopAutostartEnabled(next);
        setValue(next);
      } catch {
        setError(t('settings.openchamber.desktopAutostart.error.saveFailed'));
      } finally {
        setIsSaving(false);
      }
    },
    [isLoading, isSaving, t, visible],
  );

  if (!visible) {
    return null;
  }

  return (
    <div className="mb-8">
      <div className="mb-1 px-1">
        <h3 className="typography-ui-header font-medium text-foreground">{t('settings.openchamber.desktopAutostart.title')}</h3>
      </div>

      <section className="space-y-2 px-2 pb-2 pt-0">
        <div className="flex items-start gap-2 py-1.5">
          <Checkbox
            checked={value}
            onChange={(checked) => {
              void applyNext(checked);
            }}
            ariaLabel={t('settings.openchamber.desktopAutostart.field.enabledAria')}
            disabled={isLoading || isSaving}
          />
          <div className="min-w-0 flex-1">
            <div className="typography-ui-label text-foreground">{t('settings.openchamber.desktopAutostart.field.enabled')}</div>
            <div className="typography-micro text-muted-foreground/70">
              {t('settings.openchamber.desktopAutostart.field.enabledDescription')}
            </div>
          </div>
        </div>

        {error ? <div className="px-2 typography-micro text-[var(--status-error)]">{error}</div> : null}
      </section>
    </div>
  );
};
