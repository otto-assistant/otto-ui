import React from 'react';
import { cn } from '@/lib/utils';
import { useI18n } from '@/lib/i18n';
import { Icon } from '@/components/icon/Icon';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { toast } from '@/components/ui';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { SettingsPageLayout, SettingsSection } from '@/components/sections/shared';
import { SettingsProjectSelector } from '@/components/sections/shared/SettingsProjectSelector';
import { useProjectsStore } from '@/stores/useProjectsStore';
import {
  useMemoryStore,
  type MemoryBackend,
  type MemoryRecord,
  type MemoryRecordInput,
} from '@/stores/useMemoryStore';
import { memoryBackendIcon } from './backendMeta';

interface MemoryRecordsPageProps {
  backendId: string;
}

interface DraftState {
  open: boolean;
  editingId: string | null;
  title: string;
  content: string;
  kind: string;
  tags: string;
}

const emptyDraft: DraftState = { open: false, editingId: null, title: '', content: '', kind: '', tags: '' };

export const MemoryRecordsPage: React.FC<MemoryRecordsPageProps> = ({ backendId }) => {
  const { t } = useI18n();
  const status = useMemoryStore((s) => s.status);
  const recordsState = useMemoryStore((s) => s.records[backendId]);
  const loadRecords = useMemoryStore((s) => s.loadRecords);
  const createRecord = useMemoryStore((s) => s.createRecord);
  const updateRecord = useMemoryStore((s) => s.updateRecord);
  const deleteRecord = useMemoryStore((s) => s.deleteRecord);
  const loadStatus = useMemoryStore((s) => s.loadStatus);
  const activeProjectId = useProjectsStore((s) => s.activeProjectId);

  const backend: MemoryBackend | undefined = React.useMemo(
    () => status?.backends.find((b) => b.id === backendId),
    [status, backendId],
  );
  const projectScoped = backend?.capabilities?.projectScoped !== false;

  const [search, setSearch] = React.useState('');
  const [draft, setDraft] = React.useState<DraftState>(emptyDraft);
  const [saving, setSaving] = React.useState(false);

  React.useEffect(() => {
    if (!status) void loadStatus();
  }, [status, loadStatus]);

  // Reload when the backend changes, or (for project-scoped backends) when the
  // active project changes so records follow the selected project.
  React.useEffect(() => {
    void loadRecords(backendId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [backendId, loadRecords, projectScoped ? activeProjectId : null]);

  const items = recordsState?.items ?? [];
  const availability = recordsState?.availability;
  const loading = recordsState?.loading ?? false;

  const recordModel = backend?.recordModel ?? {};
  const caps = backend?.capabilities ?? {};

  const handleSearch = React.useCallback((value: string) => {
    setSearch(value);
    void loadRecords(backendId, value.trim() || undefined);
  }, [backendId, loadRecords]);

  const openCreate = () => setDraft({ ...emptyDraft, open: true });
  const openEdit = (record: MemoryRecord) => setDraft({
    open: true,
    editingId: record.id,
    title: record.title ?? '',
    content: record.content ?? '',
    kind: record.kind ?? '',
    tags: (record.tags ?? []).join(', '),
  });

  const submitDraft = React.useCallback(async () => {
    const input: MemoryRecordInput = {
      title: draft.title.trim() || undefined,
      content: draft.content.trim(),
      kind: draft.kind.trim() || undefined,
      tags: draft.tags.split(',').map((s) => s.trim()).filter(Boolean),
    };
    if (!input.content) return;
    setSaving(true);
    try {
      if (draft.editingId) {
        await updateRecord(backendId, draft.editingId, input);
      } else {
        await createRecord(backendId, input);
      }
      toast.success(t('settings.memory.toast.recordSaved'));
      setDraft(emptyDraft);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('settings.memory.toast.recordFailed'));
    } finally {
      setSaving(false);
    }
  }, [draft, backendId, updateRecord, createRecord, t]);

  const handleDelete = React.useCallback(async (record: MemoryRecord) => {
    if (typeof window !== 'undefined' && !window.confirm(t('settings.memory.records.deleteConfirm'))) {
      return;
    }
    try {
      await deleteRecord(backendId, record.id);
      toast.success(t('settings.memory.toast.recordDeleted'));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('settings.memory.toast.recordFailed'));
    }
  }, [backendId, deleteRecord, t]);

  return (
    <SettingsPageLayout>
      <SettingsSection>
        <div className="mb-3 flex items-start justify-between gap-3">
          <div className="flex items-center gap-2 min-w-0">
            <Icon name={memoryBackendIcon(backendId)} className="h-5 w-5 shrink-0 text-foreground" />
            <div className="min-w-0">
              <h2 className="typography-ui-header font-semibold text-foreground truncate">
                {backend?.name ?? backendId}
              </h2>
              <p className="typography-meta text-muted-foreground">
                {projectScoped ? t('settings.memory.records.subtitle') : t('settings.memory.records.subtitleGlobal')}
              </p>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {projectScoped && <SettingsProjectSelector className="w-44" />}
            {caps.create && availability?.ok !== false && (
              <Button size="sm" variant="default" onClick={openCreate}>
                <Icon name="add" className="h-4 w-4" />
                {t('settings.memory.records.add')}
              </Button>
            )}
          </div>
        </div>

        {availability && availability.ok === false ? (
          <div
            className="rounded-md border border-border/60 p-3"
            style={{ backgroundColor: 'var(--status-warning-background)', color: 'var(--status-warning)' }}
          >
            <div className="flex items-start gap-2">
              <Icon name="information" className="mt-0.5 h-4 w-4 shrink-0" />
              <span className="typography-meta">
                {availability.reason || t('settings.memory.records.unavailable')}
              </span>
            </div>
          </div>
        ) : (
          <>
            <div className="mb-3 flex items-center gap-2">
              <div className="relative flex-1">
                <Icon name="search" className="pointer-events-none absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  className="h-8 pl-8"
                  placeholder={t('settings.memory.records.searchPlaceholder')}
                  value={search}
                  onChange={(e) => handleSearch(e.target.value)}
                  disabled={!caps.search}
                />
              </div>
              <Button size="sm" variant="outline" onClick={() => void loadRecords(backendId, search.trim() || undefined)}>
                {loading ? <Icon name="loader-4" className="h-4 w-4 animate-spin" /> : <Icon name="refresh" className="h-4 w-4" />}
                {t('settings.memory.records.refresh')}
              </Button>
            </div>

            {recordsState?.error && (
              <p className="typography-meta mb-2" style={{ color: 'var(--status-error)' }}>{recordsState.error}</p>
            )}

            {items.length === 0 && !loading ? (
              <p className="typography-meta text-muted-foreground py-6 text-center">{t('settings.memory.records.empty')}</p>
            ) : (
              <ul className="space-y-2">
                {items.map((record) => (
                  <li
                    key={record.id}
                    className="group rounded-md border border-border/60 p-2.5"
                    style={{ backgroundColor: 'var(--surface-elevated)' }}
                    data-settings-item={`memory.record.${record.id}`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        {record.title && (
                          <p className="typography-ui-label font-medium text-foreground truncate">{record.title}</p>
                        )}
                        <p className={cn('typography-small text-foreground/90', !record.title && 'font-medium')}>
                          {record.content || <span className="text-muted-foreground">—</span>}
                        </p>
                        <div className="mt-1 flex flex-wrap items-center gap-1">
                          {record.kind && (
                            <span className="typography-micro rounded-full border border-border/50 px-1.5 py-0.5 text-muted-foreground">
                              {record.kind}
                            </span>
                          )}
                          {record.tags.map((tag) => (
                            <span key={tag} className="typography-micro rounded-full border border-border/50 px-1.5 py-0.5 text-muted-foreground">
                              #{tag}
                            </span>
                          ))}
                        </div>
                      </div>
                      <div className="flex shrink-0 items-center gap-1 opacity-70 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
                        {caps.update && (
                          <Button size="icon" variant="ghost" className="h-7 w-7" aria-label={t('settings.memory.records.edit')} onClick={() => openEdit(record)}>
                            <Icon name="edit" className="h-4 w-4" />
                          </Button>
                        )}
                        {caps.delete && (
                          <Button size="icon" variant="ghost" className="h-7 w-7" aria-label={t('settings.memory.records.delete')} onClick={() => void handleDelete(record)}>
                            <Icon name="delete-bin" className="h-4 w-4" style={{ color: 'var(--status-error)' }} />
                          </Button>
                        )}
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </SettingsSection>

      <Dialog open={draft.open} onOpenChange={(open) => { if (!open) setDraft(emptyDraft); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {draft.editingId ? t('settings.memory.records.edit') : t('settings.memory.records.add')}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            {recordModel.title && (
              <div>
                <label className="typography-meta text-muted-foreground">{t('settings.memory.records.field.title')}</label>
                <Input className="mt-1 h-8" value={draft.title} onChange={(e) => setDraft((d) => ({ ...d, title: e.target.value }))} />
              </div>
            )}
            <div>
              <label className="typography-meta text-muted-foreground">{t('settings.memory.records.field.content')}</label>
              <Textarea
                className="mt-1 min-h-[88px]"
                value={draft.content}
                placeholder={recordModel.triple ? 'subject | predicate | object' : t('settings.memory.records.field.contentPlaceholder')}
                onChange={(e) => setDraft((d) => ({ ...d, content: e.target.value }))}
              />
            </div>
            {recordModel.kind && (
              <div>
                <label className="typography-meta text-muted-foreground">{t('settings.memory.records.field.kind')}</label>
                <Input className="mt-1 h-8" value={draft.kind} onChange={(e) => setDraft((d) => ({ ...d, kind: e.target.value }))} />
              </div>
            )}
            {recordModel.tags && (
              <div>
                <label className="typography-meta text-muted-foreground">{t('settings.memory.records.field.tags')}</label>
                <Input className="mt-1 h-8" value={draft.tags} onChange={(e) => setDraft((d) => ({ ...d, tags: e.target.value }))} />
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDraft(emptyDraft)}>{t('settings.memory.records.cancel')}</Button>
            <Button variant="default" disabled={saving || !draft.content.trim()} onClick={() => void submitDraft()}>
              {saving ? <Icon name="loader-4" className="h-4 w-4 animate-spin" /> : null}
              {t('settings.memory.records.save')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </SettingsPageLayout>
  );
};
