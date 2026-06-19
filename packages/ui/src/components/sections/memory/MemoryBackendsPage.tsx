import React from 'react';
import { cn } from '@/lib/utils';
import { useI18n } from '@/lib/i18n';
import { Icon } from '@/components/icon/Icon';
import { Button } from '@/components/ui/button';
import { toast } from '@/components/ui';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { SettingsPageLayout, SettingsSection } from '@/components/sections/shared';
import { useUIStore } from '@/stores/useUIStore';
import { useMemoryStore, type MemoryBackend } from '@/stores/useMemoryStore';
import { memoryBackendIcon, memoryBackendSlug } from './backendMeta';

type PendingAction = {
  kind: 'install' | 'activate';
  backend: MemoryBackend;
  others: MemoryBackend[];
};

const StatusBadge: React.FC<{ backend: MemoryBackend }> = ({ backend }) => {
  const { t } = useI18n();
  let label = t('settings.memory.status.notInstalled');
  let className = 'text-muted-foreground border-border/60';
  if (backend.active) {
    label = t('settings.memory.status.active');
    className = 'text-[var(--status-success)] border-[var(--status-success-border,transparent)] bg-[var(--status-success-background)]';
  } else if (backend.installed) {
    label = t('settings.memory.status.installed');
    className = 'text-[var(--status-info)] border-[var(--status-info-border,transparent)] bg-[var(--status-info-background)]';
  }
  return (
    <span className={cn('typography-micro inline-flex items-center rounded-full border px-2 py-0.5', className)}>
      {label}
    </span>
  );
};

const BackendCard: React.FC<{
  backend: MemoryBackend;
  busy: boolean;
  onInstall: () => void;
  onActivate: () => void;
  onDeactivate: () => void;
  onManage: () => void;
}> = ({ backend, busy, onInstall, onActivate, onDeactivate, onManage }) => {
  const { t } = useI18n();
  return (
    <div
      className="rounded-lg border border-border/60 p-3"
      style={{ backgroundColor: 'var(--surface-elevated)' }}
      data-settings-item={`memory.backend.${backend.id}`}
    >
      <div className="flex items-start gap-3">
        <div
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md"
          style={{ backgroundColor: 'var(--surface-muted)' }}
        >
          <Icon name={memoryBackendIcon(backend.id)} className="h-5 w-5 text-foreground" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="typography-ui-label font-medium text-foreground truncate">{backend.name}</span>
            <StatusBadge backend={backend} />
          </div>
          <p className="typography-meta text-muted-foreground mt-0.5">{backend.tagline}</p>
        </div>
      </div>

      <p className="typography-small text-muted-foreground mt-2">{backend.description}</p>

      <div className="mt-2 flex flex-wrap items-center gap-1">
        <span className="typography-micro text-muted-foreground/70 mr-1">
          {t('settings.memory.label.integration')}: {backend.integration}
        </span>
        {backend.badges.map((badge) => (
          <span
            key={badge}
            className="typography-micro rounded-full border border-border/50 px-1.5 py-0.5 text-muted-foreground"
          >
            {badge}
          </span>
        ))}
      </div>

      {backend.requirements.length > 0 && (
        <div className="mt-2">
          <span className="typography-micro text-muted-foreground/70">{t('settings.memory.label.requirements')}</span>
          <ul className="mt-1 space-y-0.5">
            {backend.requirements.map((req) => (
              <li key={req.id} className="typography-micro text-muted-foreground flex items-start gap-1.5">
                <Icon name="check" className="mt-0.5 h-3 w-3 shrink-0 text-muted-foreground/60" />
                <span>{req.label}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {backend.issues.length > 0 && (
        <div className="mt-2 space-y-0.5">
          {backend.issues.map((issue, i) => (
            <p key={i} className="typography-micro flex items-start gap-1.5" style={{ color: 'var(--status-warning)' }}>
              <Icon name="information" className="mt-0.5 h-3 w-3 shrink-0" />
              <span>{issue}</span>
            </p>
          ))}
        </div>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {!backend.installed && (
          <Button size="sm" variant="default" disabled={busy} onClick={onInstall}>
            {busy ? (
              <>
                <Icon name="loader-4" className="h-4 w-4 animate-spin" />
                {t('settings.memory.action.installing')}
              </>
            ) : (
              <>
                <Icon name="download" className="h-4 w-4" />
                {t('settings.memory.action.install')}
              </>
            )}
          </Button>
        )}
        {backend.installed && !backend.active && (
          <Button size="sm" variant="default" disabled={busy} onClick={onActivate}>
            <Icon name="play" className="h-4 w-4" />
            {t('settings.memory.action.activate')}
          </Button>
        )}
        {backend.active && (
          <>
            <Button size="sm" variant="outline" disabled={busy} onClick={onDeactivate}>
              {t('settings.memory.action.deactivate')}
            </Button>
            {backend.capabilities.records && (
              <Button size="sm" variant="default" disabled={busy} onClick={onManage}>
                <Icon name="archive" className="h-4 w-4" />
                {t('settings.memory.action.manageRecords')}
              </Button>
            )}
          </>
        )}
        <a
          href={backend.docsUrl}
          target="_blank"
          rel="noreferrer noopener"
          className="typography-meta inline-flex items-center gap-1 text-muted-foreground hover:text-foreground"
        >
          <Icon name="external-link" className="h-3.5 w-3.5" />
          {t('settings.memory.action.docs')}
        </a>
      </div>
    </div>
  );
};

export const MemoryBackendsPage: React.FC = () => {
  const { t } = useI18n();
  const status = useMemoryStore((s) => s.status);
  const loading = useMemoryStore((s) => s.loading);
  const loadStatus = useMemoryStore((s) => s.loadStatus);
  const installBackend = useMemoryStore((s) => s.installBackend);
  const activateBackend = useMemoryStore((s) => s.activateBackend);
  const deactivateBackend = useMemoryStore((s) => s.deactivateBackend);
  const setSettingsPage = useUIStore((s) => s.setSettingsPage);

  const [busyId, setBusyId] = React.useState<string | null>(null);
  const [pending, setPending] = React.useState<PendingAction | null>(null);

  React.useEffect(() => {
    void loadStatus();
  }, [loadStatus]);

  const backends = React.useMemo(() => status?.backends ?? [], [status]);

  const runInstall = React.useCallback(async (backend: MemoryBackend, deactivateOthers: boolean) => {
    setBusyId(backend.id);
    try {
      const result = await installBackend(backend.id, deactivateOthers);
      if (result.ok) {
        toast.success(t('settings.memory.toast.installed', { name: backend.name }));
        if (result.warning) toast.error(result.warning);
      } else {
        toast.error(result.warning || t('settings.memory.toast.installFailed', { name: backend.name }));
      }
    } finally {
      setBusyId(null);
    }
  }, [installBackend, t]);

  const runActivate = React.useCallback(async (backend: MemoryBackend, deactivateOthers: boolean) => {
    setBusyId(backend.id);
    try {
      const result = await activateBackend(backend.id, deactivateOthers);
      if (result.ok) {
        toast.success(t('settings.memory.toast.activated', { name: backend.name }));
        if (result.warning) toast.error(result.warning);
      } else {
        toast.error(result.warning || t('settings.memory.toast.actionFailed'));
      }
    } finally {
      setBusyId(null);
    }
  }, [activateBackend, t]);

  const beginAction = React.useCallback((kind: 'install' | 'activate', backend: MemoryBackend) => {
    const others = backends.filter((b) => b.id !== backend.id && b.active);
    if (others.length > 0) {
      setPending({ kind, backend, others });
      return;
    }
    if (kind === 'install') void runInstall(backend, false);
    else void runActivate(backend, false);
  }, [backends, runInstall, runActivate]);

  const handleDeactivate = React.useCallback(async (backend: MemoryBackend) => {
    setBusyId(backend.id);
    try {
      const result = await deactivateBackend(backend.id);
      if (result.ok) toast.success(t('settings.memory.toast.deactivated', { name: backend.name }));
      else toast.error(result.warning || t('settings.memory.toast.actionFailed'));
    } finally {
      setBusyId(null);
    }
  }, [deactivateBackend, t]);

  const confirmPending = React.useCallback(async (deactivateOthers: boolean) => {
    if (!pending) return;
    const { kind, backend } = pending;
    setPending(null);
    if (kind === 'install') await runInstall(backend, deactivateOthers);
    else await runActivate(backend, deactivateOthers);
  }, [pending, runInstall, runActivate]);

  return (
    <SettingsPageLayout>
      <SettingsSection>
        <div className="mb-3">
          <h2 className="typography-ui-header font-semibold text-foreground">{t('settings.memory.header.title')}</h2>
          <p className="typography-meta text-muted-foreground mt-1">{t('settings.memory.header.subtitle')}</p>
        </div>

        {loading && backends.length === 0 ? (
          <div className="flex items-center gap-2 py-6 text-muted-foreground">
            <Icon name="loader-4" className="h-4 w-4 animate-spin" />
            <span className="typography-meta">{t('common.loading')}</span>
          </div>
        ) : (
          <div className="space-y-3">
            {backends.map((backend) => (
              <BackendCard
                key={backend.id}
                backend={backend}
                busy={busyId === backend.id}
                onInstall={() => beginAction('install', backend)}
                onActivate={() => beginAction('activate', backend)}
                onDeactivate={() => handleDeactivate(backend)}
                onManage={() => setSettingsPage(memoryBackendSlug(backend.id))}
              />
            ))}
          </div>
        )}
      </SettingsSection>

      <Dialog open={pending !== null} onOpenChange={(open) => { if (!open) setPending(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('settings.memory.recommend.title')}</DialogTitle>
            <DialogDescription>
              {t('settings.memory.recommend.body', {
                active: pending ? pending.others.map((b) => b.name).join(', ') : '',
              })}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="flex-col gap-2 sm:flex-row">
            <Button variant="ghost" onClick={() => setPending(null)}>
              {t('settings.memory.recommend.cancel')}
            </Button>
            <Button variant="outline" onClick={() => void confirmPending(false)}>
              {t('settings.memory.recommend.keepOthers')}
            </Button>
            <Button variant="default" onClick={() => void confirmPending(true)}>
              {t('settings.memory.recommend.deactivateContinue')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </SettingsPageLayout>
  );
};
