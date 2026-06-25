import React from 'react';
import { useI18n } from '@/lib/i18n';
import { Icon } from '@/components/icon/Icon';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { MemoryRecord } from '@/stores/useMemoryStore';
import {
  collapsedContent,
  formatRecordDate,
  groupByWing,
  shouldCollapseContent,
  sortMempalaceRecords,
  splitContentLines,
  uniqueRooms,
  uniqueWings,
  type MempalaceSort,
} from './mempalaceRecordUtils';

interface MempalaceRecordsListProps {
  items: MemoryRecord[];
  wingFilter: string;
  roomFilter: string;
  sortBy: MempalaceSort;
  onWingFilterChange: (value: string) => void;
  onRoomFilterChange: (value: string) => void;
  onSortChange: (value: MempalaceSort) => void;
  onEdit: (record: MemoryRecord) => void;
  onDelete: (record: MemoryRecord) => void;
  canUpdate: boolean;
  canDelete: boolean;
}

const MemPalaceRecordContent: React.FC<{ content: string; expanded: boolean }> = ({ content, expanded }) => {
  const lines = splitContentLines(content);
  const isMultiline = lines.length > 1;
  const display = expanded || !shouldCollapseContent(content) ? content : collapsedContent(content);

  if (!isMultiline && !display.includes('\n')) {
    return (
      <p className="typography-small whitespace-pre-wrap break-words text-foreground/90 font-mono leading-relaxed">
        {display}
      </p>
    );
  }

  if (expanded || shouldCollapseContent(content)) {
    return (
      <pre className="typography-small max-h-[28rem] overflow-auto whitespace-pre-wrap break-words rounded-md border border-border/40 bg-background/40 p-2 font-mono leading-relaxed text-foreground/90">
        {display}
      </pre>
    );
  }

  return (
    <ul className="space-y-1">
      {lines.map((line, index) => (
        <li
          key={`${index}-${line.slice(0, 24)}`}
          className="typography-small whitespace-pre-wrap break-words rounded border border-border/30 bg-background/30 px-2 py-1 font-mono text-foreground/90"
        >
          {line}
        </li>
      ))}
    </ul>
  );
};

const MempalaceRecordCard: React.FC<{
  record: MemoryRecord;
  onEdit: (record: MemoryRecord) => void;
  onDelete: (record: MemoryRecord) => void;
  canUpdate: boolean;
  canDelete: boolean;
}> = ({ record, onEdit, onDelete, canUpdate, canDelete }) => {
  const { t } = useI18n();
  const [expanded, setExpanded] = React.useState(false);
  const wing = record.wing || record.project || '';
  const room = record.room || '';
  const dateLabel = formatRecordDate(record);
  const collapsible = shouldCollapseContent(record.content || '');

  return (
    <li
      className="group rounded-md border border-border/60 p-3"
      style={{ backgroundColor: 'var(--surface-elevated)' }}
      data-settings-item={`memory.record.${record.id}`}
    >
      <div className="mb-2 flex flex-wrap items-center gap-1.5">
        {wing && (
          <span className="typography-micro rounded-full border border-border/60 bg-background/50 px-2 py-0.5 font-medium text-foreground">
            {wing}
          </span>
        )}
        {room && (
          <span className="typography-micro rounded-full border border-border/50 px-2 py-0.5 text-muted-foreground">
            {room}
          </span>
        )}
        {dateLabel && (
          <span className="typography-micro ml-auto text-muted-foreground">{dateLabel}</span>
        )}
      </div>

      <MemPalaceRecordContent content={record.content || ''} expanded={expanded} />

      <div className="mt-2 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          {collapsible && (
            <Button
              size="sm"
              variant="ghost"
              className="h-7 px-2 typography-micro"
              onClick={() => setExpanded((value) => !value)}
            >
              {expanded ? t('settings.memory.records.showLess') : t('settings.memory.records.showMore')}
            </Button>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-1 opacity-80 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
          {canUpdate && (
            <Button size="icon" variant="ghost" className="h-7 w-7" aria-label={t('settings.memory.records.edit')} onClick={() => onEdit(record)}>
              <Icon name="edit" className="h-4 w-4" />
            </Button>
          )}
          {canDelete && (
            <Button size="icon" variant="ghost" className="h-7 w-7" aria-label={t('settings.memory.records.delete')} onClick={() => void onDelete(record)}>
              <Icon name="delete-bin" className="h-4 w-4" style={{ color: 'var(--status-error)' }} />
            </Button>
          )}
        </div>
      </div>
    </li>
  );
};

export const MempalaceRecordsList: React.FC<MempalaceRecordsListProps> = ({
  items,
  wingFilter,
  roomFilter,
  sortBy,
  onWingFilterChange,
  onRoomFilterChange,
  onSortChange,
  onEdit,
  onDelete,
  canUpdate,
  canDelete,
}) => {
  const { t } = useI18n();
  const wings = React.useMemo(() => uniqueWings(items), [items]);
  const rooms = React.useMemo(() => uniqueRooms(items, wingFilter || undefined), [items, wingFilter]);
  const sorted = React.useMemo(() => sortMempalaceRecords(items, sortBy), [items, sortBy]);
  const groups = React.useMemo(() => groupByWing(sorted), [sorted]);

  const renderRecords = (records: MemoryRecord[]) => (
    <ul className="space-y-2">
      {records.map((record) => (
        <MempalaceRecordCard
          key={record.id}
          record={record}
          onEdit={onEdit}
          onDelete={onDelete}
          canUpdate={canUpdate}
          canDelete={canDelete}
        />
      ))}
    </ul>
  );

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Select value={wingFilter || '__all__'} onValueChange={(value) => onWingFilterChange(value === '__all__' ? '' : value)}>
          <SelectTrigger className="h-8 w-40" aria-label={t('settings.memory.records.filterWing')}>
            <SelectValue placeholder={t('settings.memory.records.filterWing')} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">{t('settings.memory.records.filterAllWings')}</SelectItem>
            {wings.map((wing) => (
              <SelectItem key={wing} value={wing}>{wing}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={roomFilter || '__all__'} onValueChange={(value) => onRoomFilterChange(value === '__all__' ? '' : value)}>
          <SelectTrigger className="h-8 w-40" aria-label={t('settings.memory.records.filterRoom')}>
            <SelectValue placeholder={t('settings.memory.records.filterRoom')} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">{t('settings.memory.records.filterAllRooms')}</SelectItem>
            {rooms.map((room) => (
              <SelectItem key={room} value={room}>{room}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={sortBy} onValueChange={(value) => onSortChange(value as MempalaceSort)}>
          <SelectTrigger className="h-8 w-40" aria-label={t('settings.memory.records.sortLabel')}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="newest">{t('settings.memory.records.sortNewest')}</SelectItem>
            <SelectItem value="oldest">{t('settings.memory.records.sortOldest')}</SelectItem>
            <SelectItem value="wing">{t('settings.memory.records.sortWing')}</SelectItem>
          </SelectContent>
        </Select>

        <span className="typography-micro ml-auto text-muted-foreground">
          {t('settings.memory.records.resultCount', { count: sorted.length })}
        </span>
      </div>

      {sorted.length === 0 ? (
        <p className="typography-meta text-muted-foreground py-6 text-center">{t('settings.memory.records.emptyFiltered')}</p>
      ) : (
        <div className="space-y-4">
          {groups.map(({ wing, records }) => (
            <section key={wing}>
              <div className="mb-2 flex items-center gap-2 border-b border-border/50 pb-1">
                <h3 className="typography-ui-label font-semibold text-foreground">{wing}</h3>
                <span className="typography-micro text-muted-foreground">
                  {t('settings.memory.records.wingCount', { count: records.length })}
                </span>
              </div>
              {renderRecords(records)}
            </section>
          ))}
        </div>
      )}
    </div>
  );
};
