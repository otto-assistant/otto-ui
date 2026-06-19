import React from 'react';
import { ScrollableOverlay } from '@/components/ui/ScrollableOverlay';
import { Checkbox } from '@/components/ui/checkbox';
import { UsageCard } from './UsageCard';
import { QUOTA_PROVIDERS } from '@/lib/quota';
import { useQuotaAutoRefresh, useQuotaStore } from '@/stores/useQuotaStore';
import { updateDesktopSettings } from '@/lib/persistence';
import { ProviderLogo } from '@/components/ui/ProviderLogo';
import type { UsageWindows } from '@/types';
import { getDisplayModelName } from '@/lib/quota/model-families';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { Icon } from "@/components/icon/Icon";
import { useI18n } from '@/lib/i18n';
import { formatTimeForPreference } from '@/lib/timeFormat';
import { useUIStore, type TimeFormatPreference } from '@/stores/useUIStore';
import { runtimeFetch } from '@/lib/runtime-fetch';

const formatTime = (timestamp: number | null, timeFormatPreference: TimeFormatPreference) => {
  if (!timestamp) return '-';
  try {
    return formatTimeForPreference(timestamp, timeFormatPreference, { fallback: '-' });
  } catch {
    return '-';
  }
};

/** Parse a "Resets in" string like "3h 52m" or "4d 17h" into seconds. */
const parseResetsIn = (str: string): number | null => {
  const s = str.trim().toLowerCase();
  if (!s) return null;
  let total = 0;
  const d = s.match(/(\d+)\s*d/);
  const h = s.match(/(\d+)\s*h/);
  const m = s.match(/(\d+)\s*m/);
  if (d) total += parseInt(d[1]) * 86400;
  if (h) total += parseInt(h[1]) * 3600;
  if (m) total += parseInt(m[1]) * 60;
  return total > 0 ? total : null;
};

/** Format seconds back to "Xd Xh Xm" for display. */
const formatSec = (s: number | null | undefined): string => {
  if (s == null || s <= 0) return '';
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const parts: string[] = [];
  if (d > 0) parts.push(`${d}d`);
  if (h > 0) parts.push(`${h}h`);
  if (m > 0) parts.push(`${m}m`);
  return parts.join(' ');
};

/** OpenCode Go config UI — two modes: cookie (exact) or anchor (reset times). */
const OpenCodeGoSetup: React.FC<{
  result: import('@/types').ProviderResult | null;
  onConfigSaved: () => void;
}> = ({ result, onConfigSaved }) => {
  const usageSource = result?.usageSource;
  const isAuthoritative = usageSource === 'dashboard' || usageSource === 'api' || usageSource === 'anchor';
  const hasError = result && result.configured && !result.ok;

  // Mode
  const [mode, setMode] = React.useState<'cookie' | 'anchor'>('cookie');

  // Cookie fields
  const [workspaceId, setWorkspaceId] = React.useState('');
  const [authCookie, setAuthCookie] = React.useState('');

  // Anchor fields
  const [rollingIn, setRollingIn] = React.useState('');
  const [weeklyIn, setWeeklyIn] = React.useState('');
  const [monthlyIn, setMonthlyIn] = React.useState('');

  const [saving, setSaving] = React.useState(false);
  const [saveError, setSaveError] = React.useState<string | null>(null);
  const [existingMode, setExistingMode] = React.useState<string | null>(null);
  const [loadingConfig, setLoadingConfig] = React.useState(true);

  // Load current config on mount and pre-fill fields
  const loadConfig = React.useCallback(async () => {
    try {
      const resp = await runtimeFetch('/api/quota/opencode-go/config');
      const data = await resp.json();
      if (data?.mode) setExistingMode(data.mode);
      if (data?.mode === 'cookie' || data?.mode === 'anchor') setMode(data.mode);
      if (data?.anchors) {
        setRollingIn(formatSec(data.anchors.rolling));
        setWeeklyIn(formatSec(data.anchors.weekly));
        setMonthlyIn(formatSec(data.anchors.monthly));
      }
    } catch { /* ignore */ }
  }, []);

  React.useEffect(() => {
    setLoadingConfig(true);
    loadConfig().finally(() => setLoadingConfig(false));
  }, [loadConfig]);

  const handleSave = async () => {
    setSaving(true);
    setSaveError(null);
    try {
      const body: Record<string, unknown> = { mode };

      if (mode === 'cookie') {
        if (!workspaceId.trim() || !authCookie.trim()) {
          setSaveError('Both Workspace ID and Auth Cookie are required');
          setSaving(false);
          return;
        }
        body.workspaceId = workspaceId.trim();
        body.authCookie = authCookie.trim();
      } else {
        const anchors: Record<string, number> = {};
        const r = parseResetsIn(rollingIn);
        const w = parseResetsIn(weeklyIn);
        const m = parseResetsIn(monthlyIn);
        if (!r && !w && !m) {
          setSaveError('Enter at least one "Resets in" value');
          setSaving(false);
          return;
        }
        if (r !== null) anchors.rolling = r;
        if (w !== null) anchors.weekly = w;
        if (m !== null) anchors.monthly = m;
        body.anchors = anchors;
      }

      const resp = await runtimeFetch('/api/quota/opencode-go/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      const data = await resp.json().catch(() => null);
      if (!resp.ok || !data?.ok) {
        throw new Error(data?.error || 'Failed to save');
      }
      setExistingMode(mode);
      await loadConfig();
      onConfigSaved();
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Failed to save config');
    } finally {
      setSaving(false);
    }
  };

  const handleClear = async () => {
    try {
      await runtimeFetch('/api/quota/opencode-go/config', { method: 'DELETE' });
      setExistingMode(null);
      onConfigSaved();
    } catch { /* ignore */ }
  };

  // When a mode is working, show a compact toggle to change it.
  // Otherwise show the full setup expanded.
  const [showSetup, setShowSetup] = React.useState(!isAuthoritative || !existingMode);

  // Error from dashboard mode (cookie expired etc.)
  if (hasError && result?.error && existingMode === 'cookie') {
    return (
      <div className="mb-8 rounded-lg border border-[var(--status-warning-border)] bg-[var(--status-warning-background)] px-4 py-3">
        <p className="typography-ui-label font-medium text-[var(--status-warning)] mb-1">Dashboard connection issue</p>
        <p className="typography-meta text-[var(--status-warning)]/80 mb-3">{result.error}</p>
        <div className="space-y-2">
          <label className="typography-micro text-foreground block">Workspace ID</label>
          <input className="w-full rounded-md border border-[var(--interactive-border)] bg-[var(--surface-input)] px-3 py-1.5 typography-body text-foreground" placeholder="wrk_xxx" value={workspaceId} onChange={(e) => setWorkspaceId(e.target.value)} />
          <label className="typography-micro text-foreground block">Auth Cookie</label>
          <input className="w-full rounded-md border border-[var(--interactive-border)] bg-[var(--surface-input)] px-3 py-1.5 typography-body text-foreground" placeholder="Fe26.2**..." value={authCookie} onChange={(e) => setAuthCookie(e.target.value)} />
          {saveError && <p className="typography-micro text-[var(--status-error)]">{saveError}</p>}
          <div className="flex items-center gap-2 mt-2">
            <button className="rounded-md bg-primary px-4 py-1.5 typography-ui-label text-primary-foreground hover:opacity-90 disabled:opacity-40" disabled={saving} onClick={handleSave}>{saving ? 'Saving...' : 'Save & Connect'}</button>
            <button className="rounded-md border border-[var(--interactive-border)] px-3 py-1.5 typography-ui-label text-muted-foreground hover:text-foreground" onClick={handleClear}>Clear</button>
          </div>
        </div>
      </div>
    );
  }

  // Loading existing config
  if (loadingConfig) return null;

  // Compact toggle when a mode is working
  if (isAuthoritative && existingMode) {
    return (
      <div className="mb-4 px-2">
        <button className="flex items-center gap-1.5 typography-micro text-muted-foreground hover:text-foreground transition-colors" onClick={() => setShowSetup(!showSetup)}>
          <Icon name={showSetup ? 'arrow-down-s' : 'arrow-right-s'} className="h-3.5 w-3.5" />
          {showSetup ? 'Hide data source settings' : 'Change data source'}
        </button>
        {showSetup && renderSetup()}
      </div>
    );
  }

  // Show setup fully when no mode is working yet
  return <div className="mb-8">{renderSetup()}</div>;

  function renderSetup() {
    return (
      <div className="rounded-lg border border-[var(--interactive-border)] p-4">
        <h3 className="typography-ui-label font-medium text-foreground mb-3">OpenCode Go — choose data source</h3>

        {/* ── Option 1: Cookie mode (exact) ── */}
        <label className="flex items-start gap-3 mb-3 p-3 rounded-lg border border-[var(--interactive-border)] cursor-pointer hover:bg-[var(--surface-subtle)] transition-colors">
          <input type="radio" name="og-mode" className="mt-1 accent-[var(--interactive-brand)]" checked={mode === 'cookie'} onChange={() => setMode('cookie')} />
          <div className="flex-1 min-w-0">
            <span className="typography-ui-label text-foreground font-medium">Exact data — workspace + cookie</span>
            <p className="typography-micro text-muted-foreground mt-0.5">Most accurate. Fetches live data from opencode.ai. Cookie needs periodic refresh.</p>
            {mode === 'cookie' && (
              <div className="mt-2 space-y-2">
                <input className="w-full rounded-md border border-[var(--interactive-border)] bg-[var(--surface-input)] px-3 py-1.5 typography-body text-foreground placeholder:text-muted-foreground/50" placeholder="Workspace ID (wrk_xxx)" value={workspaceId} onChange={(e) => setWorkspaceId(e.target.value)} />
                <input className="w-full rounded-md border border-[var(--interactive-border)] bg-[var(--surface-input)] px-3 py-1.5 typography-body text-foreground placeholder:text-muted-foreground/50" placeholder="Auth Cookie (Fe26.2**...)" value={authCookie} onChange={(e) => setAuthCookie(e.target.value)} />
              </div>
            )}
          </div>
        </label>

        {/* ── Option 2: Anchor mode (reset times) ── */}
        <label className="flex items-start gap-3 p-3 rounded-lg border border-[var(--interactive-border)] cursor-pointer hover:bg-[var(--surface-subtle)] transition-colors">
          <input type="radio" name="og-mode" className="mt-1 accent-[var(--interactive-brand)]" checked={mode === 'anchor'} onChange={() => setMode('anchor')} />
          <div className="flex-1 min-w-0">
            <span className="typography-ui-label text-foreground font-medium">Approximate — enter "Resets in" times</span>
            <p className="typography-micro text-muted-foreground mt-0.5">
              Uses local data with your billing cycle boundaries. Accurate if you only use Go on this machine.
              <br />Enter the <span className="text-foreground">"Resets in"</span> values shown on the opencode.ai Go dashboard.
            </p>
            {mode === 'anchor' && (
              <div className="mt-2 space-y-2">
                <div className="flex items-center gap-2">
                  <span className="typography-micro text-muted-foreground w-20 shrink-0">Rolling:</span>
                  <input className="flex-1 rounded-md border border-[var(--interactive-border)] bg-[var(--surface-input)] px-3 py-1.5 typography-body text-foreground placeholder:text-muted-foreground/50" placeholder="e.g. 3h 52m" value={rollingIn} onChange={(e) => setRollingIn(e.target.value)} />
                </div>
                <div className="flex items-center gap-2">
                  <span className="typography-micro text-muted-foreground w-20 shrink-0">Weekly:</span>
                  <input className="flex-1 rounded-md border border-[var(--interactive-border)] bg-[var(--surface-input)] px-3 py-1.5 typography-body text-foreground placeholder:text-muted-foreground/50" placeholder="e.g. 4d 17h" value={weeklyIn} onChange={(e) => setWeeklyIn(e.target.value)} />
                </div>
                <div className="flex items-center gap-2">
                  <span className="typography-micro text-muted-foreground w-20 shrink-0">Monthly:</span>
                  <input className="flex-1 rounded-md border border-[var(--interactive-border)] bg-[var(--surface-input)] px-3 py-1.5 typography-body text-foreground placeholder:text-muted-foreground/50" placeholder="e.g. 17d 9h" value={monthlyIn} onChange={(e) => setMonthlyIn(e.target.value)} />
                </div>
              </div>
            )}
          </div>
        </label>

        {saveError && <p className="typography-micro text-[var(--status-error)] mt-2">{saveError}</p>}

        <div className="flex items-center gap-2 mt-3">
          <button className="rounded-md bg-primary px-4 py-1.5 typography-ui-label text-primary-foreground hover:opacity-90 disabled:opacity-40" disabled={saving} onClick={handleSave}>{saving ? 'Saving...' : 'Save'}</button>
          {existingMode && (
            <button className="rounded-md border border-[var(--interactive-border)] px-3 py-1.5 typography-ui-label text-muted-foreground hover:text-foreground" onClick={handleClear}>Clear & disable</button>
          )}
        </div>
      </div>
    );
  }
};

interface ModelInfo {
  name: string;
  windows: UsageWindows;
}

export const UsagePage: React.FC = () => {
  const { t } = useI18n();
  const timeFormatPreference = useUIStore((state) => state.timeFormatPreference);
  const results = useQuotaStore((state) => state.results);
  const selectedProviderId = useQuotaStore((state) => state.selectedProviderId);
  const setSelectedProvider = useQuotaStore((state) => state.setSelectedProvider);
  const loadSettings = useQuotaStore((state) => state.loadSettings);
  const fetchAllQuotas = useQuotaStore((state) => state.fetchAllQuotas);
  const isLoading = useQuotaStore((state) => state.isLoading);
  const lastUpdated = useQuotaStore((state) => state.lastUpdated);
  const error = useQuotaStore((state) => state.error);
  const dropdownProviderIds = useQuotaStore((state) => state.dropdownProviderIds);
  const setDropdownProviderIds = useQuotaStore((state) => state.setDropdownProviderIds);
  useQuotaAutoRefresh();

  React.useEffect(() => {
    void loadSettings();
    void fetchAllQuotas();
  }, [loadSettings, fetchAllQuotas]);

  React.useEffect(() => {
    if (selectedProviderId) {
      return;
    }
    if (results.length === 0) {
      return;
    }
    const firstConfigured = results.find((entry) => entry.configured)?.providerId;
    setSelectedProvider(firstConfigured ?? QUOTA_PROVIDERS[0]?.id ?? null);
  }, [results, selectedProviderId, setSelectedProvider]);

  const selectedResult = results.find((entry) => entry.providerId === selectedProviderId) ?? null;

  const providerMeta = QUOTA_PROVIDERS.find((provider) => provider.id === selectedProviderId);
  const providerName = providerMeta?.name ?? selectedProviderId ?? t('settings.usage.sidebar.title');
  const usage = selectedResult?.usage;
  const showInDropdown = selectedProviderId ? dropdownProviderIds.includes(selectedProviderId) : false;
  const handleDropdownToggle = React.useCallback((enabled: boolean) => {
    if (!selectedProviderId) {
      return;
    }
    const next = enabled
      ? Array.from(new Set([...dropdownProviderIds, selectedProviderId]))
      : dropdownProviderIds.filter((id) => id !== selectedProviderId);
    setDropdownProviderIds(next);
    void updateDesktopSettings({ usageDropdownProviders: next });
  }, [dropdownProviderIds, selectedProviderId, setDropdownProviderIds]);

  const providerModels = React.useMemo((): ModelInfo[] => {
    if (!usage?.models) return [];
    return Object.entries(usage.models)
      .map(([name, modelUsage]) => ({ name, windows: modelUsage }))
      .filter((model) => Object.keys(model.windows.windows).length > 0);
  }, [usage?.models]);

  if (!selectedProviderId) {
    return (
        <div className="flex h-full items-center justify-center text-muted-foreground">
        <p className="typography-body">{t('settings.usage.page.empty.selectProvider')}</p>
      </div>
    );
  }

  return (
    <ScrollableOverlay outerClassName="h-full" className="w-full">
      <div className="mx-auto w-full max-w-3xl p-3 sm:p-6 sm:pt-8">

        {/* Header */}
        <div className="mb-4 flex items-center gap-3">
          <ProviderLogo providerId={selectedProviderId} className="h-5 w-5 shrink-0" />
          <div className="min-w-0">
            <h2 className="typography-ui-header font-semibold text-foreground truncate">
              {t('settings.usage.page.header.providerUsage', { provider: providerName })}
            </h2>
            <p className="typography-meta text-muted-foreground truncate">
              {isLoading ? (
                <span className="animate-pulse">{t('settings.usage.page.header.refreshing')}</span>
              ) : (
                t('settings.usage.page.header.lastUpdated', { time: formatTime(lastUpdated, timeFormatPreference) })
              )}
            </p>
          </div>
        </div>

        {/* Options */}
        <div data-settings-item="usage.header-menu" className="mb-8 px-2">
          <div
            className="group flex cursor-pointer items-center gap-2 py-1.5"
            role="button"
            tabIndex={0}
            aria-pressed={showInDropdown}
            onClick={() => handleDropdownToggle(!showInDropdown)}
            onKeyDown={(event) => {
              if (event.key === ' ' || event.key === 'Enter') {
                event.preventDefault();
                handleDropdownToggle(!showInDropdown);
              }
            }}
          >
              <Checkbox
                checked={showInDropdown}
                onChange={handleDropdownToggle}
                ariaLabel={t('settings.usage.page.options.showInHeaderAria')}
              />
              <div className="flex min-w-0 items-center gap-1.5">
              <span className="typography-ui-label text-foreground">{t('settings.usage.page.options.showInHeader')}</span>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Icon name="information" className="h-3.5 w-3.5 text-muted-foreground/60 cursor-help" />
                </TooltipTrigger>
                <TooltipContent sideOffset={8} className="max-w-xs">
                  {t('settings.usage.page.options.showInHeaderTooltip')}
                </TooltipContent>
              </Tooltip>
            </div>
          </div>
        </div>

        {/* State Messages */}
        {!selectedResult && (
          <div className="mb-8 px-2">
            <p className="typography-ui-label text-foreground">{t('settings.usage.page.state.noData')}</p>
          </div>
        )}

        {error && (
          <div className="mb-8 rounded-lg border border-[var(--status-error-border)] bg-[var(--status-error-background)] px-4 py-3">
            <p className="typography-ui-label font-medium text-[var(--status-error)]">{t('settings.usage.page.state.refreshFailedTitle')}</p>
            <p className="typography-meta text-[var(--status-error)]/80 mt-1">{error}</p>
          </div>
        )}

        {selectedResult && !selectedResult.configured && selectedResult.providerId !== 'opencode-go' && (
          <div className="mb-8 rounded-lg border border-[var(--status-warning-border)] bg-[var(--status-warning-background)] px-4 py-3">
            <p className="typography-ui-label font-medium text-[var(--status-warning)]">{t('settings.usage.page.state.providerNotConfiguredTitle')}</p>
            <p className="typography-meta text-[var(--status-warning)]/80 mt-1">
              {t('settings.usage.page.state.providerNotConfiguredDescription')}
            </p>
          </div>
        )}

        {selectedResult && selectedResult.configured && !selectedResult.ok && selectedResult.error && (
          <div className="mb-8 rounded-lg border border-[var(--status-warning-border)] bg-[var(--status-warning-background)] px-4 py-3">
            <p className="typography-ui-label font-medium text-[var(--status-warning)]">{t('settings.usage.page.state.refreshFailedTitle')}</p>
            <p className="typography-meta text-[var(--status-warning)]/80 mt-1">{selectedResult.error}</p>
          </div>
        )}

        {/* ── OpenCode Go: setup guide / fallback UI ── */}
        {selectedProviderId === 'opencode-go' && <OpenCodeGoSetup result={selectedResult} onConfigSaved={() => fetchAllQuotas()} />}

        {/* Overall Usage Windows */}
        {usage?.windows && Object.keys(usage.windows).length > 0 && (
          <div data-settings-item="usage.model-quotas" className="mb-8">
            <section className="px-2 pb-2 pt-0">
              <div className="divide-y divide-[var(--surface-subtle)]">
                {Object.entries(usage.windows).map(([label, window]) => (
                  <UsageCard key={label} title={label} window={window} />
                ))}
              </div>
            </section>
          </div>
        )}

        {/* Models Section — flat list, no collapsible families, no checkboxes */}
        {providerModels.length > 0 && (
          <div className="mb-8">
            <div className="mb-1 px-1">
              <h3 className="typography-ui-header font-medium text-foreground">{t('settings.usage.page.section.modelQuotas')}</h3>
            </div>
            <div className="divide-y divide-[var(--surface-subtle)]">
              {providerModels.map((model) => {
                const entries = Object.entries(model.windows.windows);
                if (entries.length === 0) return null;
                const [label, window] = entries[0];
                return (
                  <UsageCard
                    key={model.name}
                    title={label}
                    subtitle={getDisplayModelName(model.name)}
                    window={window}
                  />
                );
              })}
            </div>
          </div>
        )}

        {selectedResult?.configured && usage && Object.keys(usage.windows ?? {}).length === 0 &&
          providerModels.length === 0 && (
          <div className="mb-8 px-2">
            <p className="typography-ui-label text-foreground">{t('settings.usage.page.state.noQuotaWindowsTitle')}</p>
            <p className="typography-meta text-muted-foreground mt-1">{t('settings.usage.page.state.noQuotaWindowsDescription')}</p>
          </div>
        )}

      </div>
    </ScrollableOverlay>
  );
};
