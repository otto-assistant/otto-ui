import React, { useState } from 'react';
import { useI18n } from '@/lib/i18n';
import { useOttoSettingsStore } from '@/stores/useOttoSettingsStore';

export const UpgradeSection: React.FC = () => {
  const { t } = useI18n();
  const { status, availableUpdate, error, upgrading, checkForUpdates, triggerUpgrade } = useOttoSettingsStore();
  const [checking, setChecking] = useState(false);
  const [checked, setChecked] = useState(false);

  const handleCheck = async () => {
    setChecking(true);
    await checkForUpdates();
    setChecking(false);
    setChecked(true);
  };

  const handleUpgrade = async () => {
    await triggerUpgrade();
  };

  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <h3 className="text-sm font-medium text-foreground">{t('settings.otto.upgrade.title')}</h3>
      <div className="mt-3 space-y-3">
        <div className="flex items-center justify-between text-xs">
          <span className="text-muted-foreground">{t('settings.otto.upgrade.currentVersionLabel')}</span>
          <span className="font-mono text-foreground">{status?.version ?? '—'}</span>
        </div>
        {availableUpdate && (
          <div className="flex items-center justify-between text-xs">
            <span className="text-muted-foreground">{t('settings.otto.upgrade.availableLabel')}</span>
            <span className="font-mono text-[color:var(--status-success)]">{availableUpdate.version}</span>
          </div>
        )}
        {checked && !checking && !availableUpdate && !error && (
          <p className="text-xs text-muted-foreground">{t('settings.otto.upgrade.upToDate')}</p>
        )}
        {error && (
          <p className="text-xs text-[color:var(--status-error)]">{error}</p>
        )}
        <div className="flex gap-2">
          <button
            onClick={handleCheck}
            disabled={checking}
            className="rounded-md border border-border bg-background px-3 py-1.5 text-xs text-foreground transition-colors hover:bg-accent disabled:opacity-50"
          >
            {checking ? t('settings.otto.upgrade.checking') : t('settings.otto.upgrade.checkAction')}
          </button>
          {availableUpdate && (
            <button
              onClick={handleUpgrade}
              disabled={upgrading}
              className="rounded-md bg-primary px-3 py-1.5 text-xs text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
            >
              {upgrading
                ? t('settings.otto.upgrade.upgrading')
                : t('settings.otto.upgrade.upgradeAction', { version: availableUpdate.version })}
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
