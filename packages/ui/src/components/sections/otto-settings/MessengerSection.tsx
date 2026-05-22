import React, { useState } from 'react';
import { RiDiscordLine, RiTelegramLine, RiCheckLine, RiCloseLine, RiLoader4Line, RiAddLine } from '@remixicon/react';
import { useMessengerStore, type MessengerType, type MessengerConnection, type SyncMode } from '@/stores/useMessengerStore';
import { useProjectsStore } from '@/stores/useProjectsStore';
import { cn } from '@/lib/utils';

const MESSENGER_META: Record<MessengerType, { name: string; icon: typeof RiDiscordLine; color: string; tokenLabel: string; tokenHelp: string }> = {
  discord: {
    name: 'Discord',
    icon: RiDiscordLine,
    color: 'text-[#5865F2]',
    tokenLabel: 'Bot Token',
    tokenHelp: 'Create at discord.com/developers → Bot → Token',
  },
  telegram: {
    name: 'Telegram',
    icon: RiTelegramLine,
    color: 'text-[#26A5E4]',
    tokenLabel: 'Bot Token',
    tokenHelp: 'Get from @BotFather on Telegram',
  },
};

const SYNC_MODES: { id: SyncMode; label: string; desc: string }[] = [
  { id: 'full', label: 'Full Sync', desc: 'Projects as channels, sessions as threads, all messages' },
  { id: 'notifications', label: 'Notifications', desc: 'Task completions, schedule triggers, errors' },
  { id: 'off', label: 'Off', desc: 'Connected but no automatic sync' },
];

function StatusBadge({ status }: { status: MessengerConnection['status'] }) {
  const styles: Record<string, string> = {
    connected: 'bg-green-500/20 text-green-500',
    connecting: 'bg-yellow-500/20 text-yellow-500',
    error: 'bg-red-500/20 text-red-500',
    disconnected: 'bg-muted text-muted-foreground',
  };
  return (
    <span className={cn('rounded-full px-2 py-0.5 text-[10px] font-medium', styles[status])}>
      {status === 'connecting' && <RiLoader4Line className="inline size-3 animate-spin mr-0.5" />}
      {status}
    </span>
  );
}

function ConnectionCard({ conn }: { conn: MessengerConnection }) {
  const updateConnection = useMessengerStore((s) => s.updateConnection);
  const testConnection = useMessengerStore((s) => s.testConnection);
  const removeConnection = useMessengerStore((s) => s.removeConnection);
  const projects = useProjectsStore((s) => s.projects);
  const projectMappings = useMessengerStore((s) => s.projectMappings);
  const setProjectMapping = useMessengerStore((s) => s.setProjectMapping);

  const meta = MESSENGER_META[conn.type];
  const Icon = meta.icon;
  const [showToken, setShowToken] = useState(false);
  const [tokenInput, setTokenInput] = useState('');
  const token = conn.type === 'discord' ? conn.botToken : conn.telegramBotToken;

  const handleSaveToken = () => {
    if (!tokenInput.trim()) return;
    if (conn.type === 'discord') {
      updateConnection('discord', { botToken: tokenInput.trim(), enabled: true });
    } else {
      updateConnection('telegram', { telegramBotToken: tokenInput.trim(), enabled: true });
    }
    setTokenInput('');
    setShowToken(false);
  };

  const inputClass = "w-full rounded-md border border-border bg-background px-3 py-1.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring";

  return (
    <div className="rounded-lg border border-border bg-card p-4 space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Icon className={cn('size-5', meta.color)} />
          <span className="text-sm font-medium text-foreground">{meta.name}</span>
          <StatusBadge status={conn.status} />
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => testConnection(conn.type)}
            disabled={!token || conn.status === 'connecting'}
            className="rounded px-2 py-1 text-[10px] font-medium text-primary bg-primary/10 hover:bg-primary/20 disabled:opacity-50"
          >
            Test
          </button>
          <button
            type="button"
            onClick={() => removeConnection(conn.type)}
            className="text-muted-foreground hover:text-destructive"
          >
            <RiCloseLine className="size-4" />
          </button>
        </div>
      </div>

      {conn.error && (
        <div className="rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive">{conn.error}</div>
      )}

      {/* Token config */}
      {!token ? (
        <div className="space-y-2">
          <div className="text-xs text-muted-foreground">{meta.tokenHelp}</div>
          <div className="flex gap-2">
            <input
              type="password"
              value={tokenInput}
              onChange={(e) => setTokenInput(e.target.value)}
              placeholder={meta.tokenLabel}
              className={inputClass}
            />
            <button type="button" onClick={handleSaveToken} disabled={!tokenInput.trim()} className="shrink-0 rounded bg-primary px-3 py-1.5 text-xs text-primary-foreground disabled:opacity-50">
              Save
            </button>
          </div>
        </div>
      ) : (
        <div className="flex items-center gap-2 text-xs">
          <RiCheckLine className="size-3 text-green-500" />
          <span className="text-muted-foreground">Token configured</span>
          <button type="button" onClick={() => setShowToken(!showToken)} className="text-primary text-[10px]">
            {showToken ? 'Hide' : 'Change'}
          </button>
          {showToken && (
            <div className="flex gap-2 flex-1">
              <input type="password" value={tokenInput} onChange={(e) => setTokenInput(e.target.value)} placeholder="New token" className={inputClass} />
              <button type="button" onClick={handleSaveToken} disabled={!tokenInput.trim()} className="rounded bg-primary px-2 py-1 text-[10px] text-primary-foreground disabled:opacity-50">
                Update
              </button>
            </div>
          )}
        </div>
      )}

      {/* Sync mode */}
      <div className="space-y-1.5">
        <div className="text-xs font-medium text-foreground">Sync Mode</div>
        <div className="flex gap-1">
          {SYNC_MODES.map(mode => (
            <button
              key={mode.id}
              type="button"
              onClick={() => updateConnection(conn.type, { syncMode: mode.id })}
              className={cn(
                'flex-1 rounded-md px-2 py-1.5 text-[10px] font-medium transition-colors',
                conn.syncMode === mode.id ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:text-foreground'
              )}
              title={mode.desc}
            >
              {mode.label}
            </button>
          ))}
        </div>
      </div>

      {/* Sync options */}
      <div className="flex flex-wrap gap-3 text-xs">
        {(['syncProjects', 'syncTasks', 'syncSchedule', 'autoCreateThreads'] as const).map(key => (
          <label key={key} className="flex items-center gap-1.5 cursor-pointer">
            <input
              type="checkbox"
              checked={conn[key]}
              onChange={(e) => updateConnection(conn.type, { [key]: e.target.checked })}
              className="rounded border-border accent-primary"
            />
            <span className="text-muted-foreground">{key.replace(/([A-Z])/g, ' $1').replace('sync ', '').trim()}</span>
          </label>
        ))}
      </div>

      {/* Project ↔ Channel mappings */}
      {conn.syncProjects && projects.length > 0 && (
        <div className="space-y-2">
          <div className="text-xs font-medium text-foreground">Project → {conn.type === 'discord' ? 'Channel' : 'Topic'} Mapping</div>
          {projects.slice(0, 10).map(project => {
            const mapping = projectMappings.find(m => m.projectId === project.id);
            const channelName = conn.type === 'discord' ? mapping?.discord?.channelName : mapping?.telegram?.topicName;
            return (
              <div key={project.id} className="flex items-center gap-2 text-xs">
                <span className="text-foreground min-w-0 truncate flex-1">{project.label || project.path.split('/').pop()}</span>
                <span className="text-muted-foreground">→</span>
                <input
                  type="text"
                  value={channelName ?? ''}
                  onChange={(e) => {
                    const name = e.target.value;
                    const update: typeof mapping = {
                      projectId: project.id,
                      projectLabel: project.label || project.path.split('/').pop() || project.path,
                      ...(conn.type === 'discord'
                        ? { discord: { channelId: project.id, channelName: name } }
                        : { telegram: { topicId: project.id, topicName: name } }),
                    };
                    setProjectMapping(update);
                  }}
                  placeholder={`#${(project.label || project.path.split('/').pop() || '').toLowerCase().replace(/\s+/g, '-')}`}
                  className="w-32 rounded border border-border bg-background px-2 py-0.5 text-xs text-foreground"
                />
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export const MessengerSection: React.FC = () => {
  const connections = useMessengerStore((s) => s.connections);
  const startOnboarding = useMessengerStore((s) => s.startOnboarding);

  const availableTypes: MessengerType[] = (['discord', 'telegram'] as const).filter(
    type => !connections.some(c => c.type === type),
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-medium text-foreground">Messenger Sync</h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            Sync projects, tasks, and conversations with Discord and Telegram.
          </p>
        </div>
      </div>

      {connections.map(conn => (
        <ConnectionCard key={conn.type} conn={conn} />
      ))}

      {availableTypes.length > 0 && (
        <div className="flex gap-2">
          {availableTypes.map(type => {
            const meta = MESSENGER_META[type];
            const Icon = meta.icon;
            return (
              <button
                key={type}
                type="button"
                onClick={() => startOnboarding(type)}
                className="flex items-center gap-2 rounded-lg border border-dashed border-border px-4 py-3 text-sm text-muted-foreground hover:border-primary/30 hover:text-foreground transition-colors"
              >
                <RiAddLine className="size-4" />
                <Icon className={cn('size-4', meta.color)} />
                Connect {meta.name}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
};
