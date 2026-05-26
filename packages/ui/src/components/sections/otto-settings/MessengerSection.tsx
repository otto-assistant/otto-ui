import React, { useMemo, useState } from 'react';
import {
  RiDiscordLine,
  RiTelegramLine,
  RiCheckLine,
  RiCloseLine,
  RiLoader4Line,
  RiAddLine,
  RiSendPlaneLine,
  RiRefreshLine,
  RiInformationLine,
  RiAlertLine,
  RiCheckboxCircleFill,
  RiCheckboxBlankCircleLine,
  RiExternalLinkLine,
  RiEyeLine,
  RiEyeOffLine,
} from '@remixicon/react';
import {
  useMessengerStore,
  type MessengerType,
  type MessengerConnection,
  type SyncMode,
} from '@/stores/useMessengerStore';
import { useProjectsStore } from '@/stores/useProjectsStore';
import { useTasksStore } from '@/stores/useTasksStore';
import { cn } from '@/lib/utils';

interface MessengerMeta {
  name: string;
  icon: typeof RiDiscordLine;
  color: string;
  tokenLabel: string;
  tokenHelp: React.ReactNode;
  targetLabel: string;
  targetPlaceholder: string;
  targetHelp: React.ReactNode;
}

const MESSENGER_META: Record<MessengerType, MessengerMeta> = {
  discord: {
    name: 'Discord',
    icon: RiDiscordLine,
    color: 'text-[#5865F2]',
    tokenLabel: 'Bot Token',
    tokenHelp: (
      <>
        Create a bot at{' '}
        <a
          href="https://discord.com/developers/applications"
          target="_blank"
          rel="noreferrer"
          className="text-primary hover:underline inline-flex items-center gap-0.5"
        >
          discord.com/developers <RiExternalLinkLine className="size-3" />
        </a>{' '}
        → New Application → Bot tab → Reset Token. Make sure the{' '}
        <em>Message Content</em> intent is enabled if you want Otto to read replies.
      </>
    ),
    targetLabel: 'Channel ID',
    targetPlaceholder: 'e.g. 1234567890123456789',
    targetHelp: (
      <>
        In Discord, open <em>Settings → Advanced → Developer Mode</em>, then right-click the target
        text channel and choose <strong>"Copy Channel ID"</strong>. Your bot must already be a
        member of that server and have <em>View Channel</em> + <em>Send Messages</em> permission —
        if not, use the invite link above first.
      </>
    ),
  },
  telegram: {
    name: 'Telegram',
    icon: RiTelegramLine,
    color: 'text-[#26A5E4]',
    tokenLabel: 'Bot Token',
    tokenHelp: (
      <>
        Open{' '}
        <a
          href="https://t.me/BotFather"
          target="_blank"
          rel="noreferrer"
          className="text-primary hover:underline inline-flex items-center gap-0.5"
        >
          @BotFather <RiExternalLinkLine className="size-3" />
        </a>{' '}
        on Telegram → <code className="text-[10px] bg-muted px-1 rounded">/newbot</code> → copy the
        token it sends back.
      </>
    ),
    targetLabel: 'Chat ID',
    targetPlaceholder: 'e.g. -1001234567890',
    targetHelp: (
      <>
        Add your bot to the target chat/group, then forward any message from that chat to{' '}
        <a
          href="https://t.me/userinfobot"
          target="_blank"
          rel="noreferrer"
          className="text-primary hover:underline inline-flex items-center gap-0.5"
        >
          @userinfobot <RiExternalLinkLine className="size-3" />
        </a>{' '}
        — it will reply with the chat ID. Groups start with a minus sign (e.g.{' '}
        <code className="text-[10px] bg-muted px-1 rounded">-1001234567890</code>).
      </>
    ),
  },
};

const SYNC_MODES: { id: SyncMode; label: string; desc: string }[] = [
  { id: 'full', label: 'Full Sync', desc: 'Projects as channels, sessions as threads, all messages' },
  { id: 'notifications', label: 'Notifications', desc: 'Task completions, schedule triggers, errors' },
  { id: 'off', label: 'Off', desc: 'Connected but no automatic sync' },
];

function StatusBadge({ status }: { status: MessengerConnection['status'] }) {
  const styles: Record<string, string> = {
    connected: 'bg-green-500/20 text-green-600 dark:text-green-400',
    connecting: 'bg-yellow-500/20 text-yellow-600 dark:text-yellow-400',
    error: 'bg-red-500/20 text-red-600 dark:text-red-400',
    disconnected: 'bg-muted text-muted-foreground',
  };
  return (
    <span className={cn('rounded-full px-2 py-0.5 text-[10px] font-medium', styles[status])}>
      {status === 'connecting' && (
        <RiLoader4Line className="inline size-3 animate-spin mr-0.5" />
      )}
      {status}
    </span>
  );
}

function ChecklistItem({
  done,
  label,
  hint,
}: {
  done: boolean;
  label: string;
  hint?: string;
}) {
  return (
    <li className="flex items-start gap-2">
      {done ? (
        <RiCheckboxCircleFill className="size-4 shrink-0 text-green-500" />
      ) : (
        <RiCheckboxBlankCircleLine className="size-4 shrink-0 text-muted-foreground" />
      )}
      <div className="text-xs">
        <span className={cn(done ? 'text-foreground' : 'text-muted-foreground')}>{label}</span>
        {hint ? <span className="text-muted-foreground"> — {hint}</span> : null}
      </div>
    </li>
  );
}

function formatRelative(ts: number | null): string {
  if (!ts) return 'never';
  const diff = Date.now() - ts;
  if (diff < 60_000) return 'just now';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return new Date(ts).toLocaleString();
}

function ConnectionCard({ conn }: { conn: MessengerConnection }) {
  const updateConnection = useMessengerStore((s) => s.updateConnection);
  const testConnection = useMessengerStore((s) => s.testConnection);
  const removeConnection = useMessengerStore((s) => s.removeConnection);
  const resolveTelegramChat = useMessengerStore((s) => s.resolveTelegramChat);
  const resolveDiscordChannel = useMessengerStore((s) => s.resolveDiscordChannel);
  const fetchDiscordInviteUrl = useMessengerStore((s) => s.fetchDiscordInviteUrl);
  const sendTestMessage = useMessengerStore((s) => s.sendTestMessage);
  const sendSyncSummary = useMessengerStore((s) => s.sendSyncSummary);
  const projects = useProjectsStore((s) => s.projects);
  const tasks = useTasksStore((s) => s.tasks);
  const projectMappings = useMessengerStore((s) => s.projectMappings);
  const setProjectMapping = useMessengerStore((s) => s.setProjectMapping);

  const meta = MESSENGER_META[conn.type];
  const Icon = meta.icon;

  const [showToken, setShowToken] = useState(false);
  const [tokenInput, setTokenInput] = useState('');
  const [showTokenPlain, setShowTokenPlain] = useState(false);
  const [targetInput, setTargetInput] = useState('');

  const token = conn.type === 'discord' ? conn.botToken : conn.telegramBotToken;
  const target = conn.type === 'discord' ? conn.defaultChannelId : conn.telegramChatId;

  const hasToken = Boolean(token);
  const hasTarget = Boolean(target);
  const isConnected = conn.status === 'connected';
  const setupComplete = hasToken && hasTarget && isConnected;

  const handleSaveToken = () => {
    if (!tokenInput.trim()) return;
    if (conn.type === 'discord') {
      updateConnection('discord', { botToken: tokenInput.trim(), enabled: true });
    } else {
      updateConnection('telegram', { telegramBotToken: tokenInput.trim(), enabled: true });
    }
    setTokenInput('');
    setShowToken(false);
    setShowTokenPlain(false);
  };

  const handleSaveTarget = async () => {
    const value = targetInput.trim();
    if (!value) return;
    if (conn.type === 'discord') {
      updateConnection('discord', { defaultChannelId: value });
      setTimeout(() => {
        resolveDiscordChannel();
      }, 0);
    } else {
      updateConnection('telegram', { telegramChatId: value });
      setTimeout(() => {
        resolveTelegramChat();
      }, 0);
    }
    setTargetInput('');
  };

  const inputClass =
    'w-full rounded-md border border-border bg-background px-3 py-1.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring';

  const buildSummary = (): string => {
    const projectCount = projects.length;
    const openTasks = tasks.filter((t) => t.status !== 'done' && t.status !== 'cancelled').length;
    const doneToday = tasks.filter((t) => {
      if (t.status !== 'done') return false;
      const ts = t.updatedAt ? Date.parse(t.updatedAt) : NaN;
      return Number.isFinite(ts) && Date.now() - ts < 86_400_000;
    }).length;
    const upcoming = tasks
      .filter((t) => t.dueAt && t.status !== 'done' && t.status !== 'cancelled')
      .sort((a, b) => Date.parse(a.dueAt!) - Date.parse(b.dueAt!))
      .slice(0, 3);

    const lines = [
      conn.type === 'telegram' ? '🤖 *Otto sync summary*' : '**🤖 Otto sync summary**',
      '',
      `• Projects: ${projectCount}`,
      `• Open tasks: ${openTasks}`,
      `• Completed (24h): ${doneToday}`,
    ];
    if (upcoming.length > 0) {
      lines.push('', 'Next up:');
      for (const t of upcoming) {
        const when = t.dueAt ? new Date(t.dueAt).toLocaleString() : '';
        lines.push(`• ${t.title}${when ? ` — ${when}` : ''}`);
      }
    }
    lines.push('', `_Sent ${new Date().toLocaleString()}_`);
    return lines.join('\n');
  };

  return (
    <div className="rounded-lg border border-border bg-card p-4 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Icon className={cn('size-5', meta.color)} />
          <span className="text-sm font-medium text-foreground">{meta.name}</span>
          <StatusBadge status={conn.status} />
          {conn.type === 'telegram' && conn.telegramBotUsername && (
            <span className="text-[10px] text-muted-foreground">@{conn.telegramBotUsername}</span>
          )}
          {conn.type === 'discord' && conn.discordBotUsername && (
            <span className="text-[10px] text-muted-foreground">
              {conn.discordBotUsername}
              {conn.discordBotDiscriminator && conn.discordBotDiscriminator !== '0'
                ? `#${conn.discordBotDiscriminator}`
                : ''}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => testConnection(conn.type)}
            disabled={!token || conn.status === 'connecting'}
            className="rounded px-2 py-1 text-[10px] font-medium text-primary bg-primary/10 hover:bg-primary/20 disabled:opacity-50"
            title="Verify the bot token by calling the messenger API"
          >
            {conn.status === 'connecting' ? 'Testing…' : 'Verify token'}
          </button>
          <button
            type="button"
            onClick={() => removeConnection(conn.type)}
            className="text-muted-foreground hover:text-destructive"
            title={`Disconnect ${meta.name}`}
          >
            <RiCloseLine className="size-4" />
          </button>
        </div>
      </div>

      {/* Connection error */}
      {conn.error && (
        <div className="rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive flex items-start gap-2">
          <RiAlertLine className="size-3.5 shrink-0 mt-0.5" />
          <span>{conn.error}</span>
        </div>
      )}

      {/* Setup checklist */}
      <div className="rounded-md border border-border/60 bg-muted/30 p-3 space-y-2">
        <div className="flex items-center justify-between">
          <div className="text-xs font-medium text-foreground flex items-center gap-1.5">
            <RiInformationLine className="size-3.5 text-primary" />
            Setup
          </div>
          {setupComplete && (
            <span className="text-[10px] font-medium text-green-600 dark:text-green-400">
              All set ✓
            </span>
          )}
        </div>
        <ul className="space-y-1">
          <ChecklistItem
            done={hasToken}
            label="1. Add bot token"
            hint={hasToken ? undefined : 'paste the token below'}
          />
          <ChecklistItem
            done={isConnected}
            label="2. Verify token"
            hint={
              !hasToken
                ? undefined
                : isConnected
                  ? conn.type === 'telegram'
                    ? `connected as ${conn.telegramBotUsername ? '@' + conn.telegramBotUsername : 'bot'}`
                    : `connected as ${conn.discordBotUsername ?? 'bot'} — ${conn.discordGuilds?.length ?? 0} server${(conn.discordGuilds?.length ?? 0) === 1 ? '' : 's'}`
                  : 'click "Verify token" above'
            }
          />
          <ChecklistItem
            done={hasTarget}
            label={`3. Add ${conn.type === 'telegram' ? 'chat ID' : 'channel ID'}`}
            hint={
              hasTarget
                ? conn.type === 'telegram'
                  ? (conn.telegramChatTitle ?? conn.telegramChatId)
                  : conn.discordChannelName
                    ? `#${conn.discordChannelName}${conn.guildName ? ` (${conn.guildName})` : ''}`
                    : conn.defaultChannelId
                : 'see the field below'
            }
          />
          <ChecklistItem
            done={Boolean(conn.lastSyncAt)}
            label="4. Send a test message"
            hint={
              conn.lastSyncAt
                ? `last activity ${formatRelative(conn.lastSyncAt)}`
                : 'use the "Send test message" button'
            }
          />
        </ul>

        {setupComplete && (
          <div className="mt-1.5 text-[11px] text-green-700 dark:text-green-400 leading-snug">
            Otto will post task completions, schedule triggers and errors to{' '}
            {conn.type === 'telegram'
              ? conn.telegramChatTitle
                ? `"${conn.telegramChatTitle}"`
                : 'your chat'
              : conn.discordChannelName
                ? `#${conn.discordChannelName}${conn.guildName ? ` in ${conn.guildName}` : ''}`
                : 'your channel'}{' '}
            based on the sync mode below.
          </div>
        )}
      </div>

      {/* Step 1: Token */}
      {!token ? (
        <div className="space-y-2">
          <div className="text-xs font-medium text-foreground">{meta.tokenLabel}</div>
          <div className="text-[11px] text-muted-foreground leading-snug">{meta.tokenHelp}</div>
          <div className="flex gap-2">
            <div className="relative flex-1">
              <input
                type={showTokenPlain ? 'text' : 'password'}
                value={tokenInput}
                onChange={(e) => setTokenInput(e.target.value)}
                placeholder={meta.tokenLabel}
                className={cn(inputClass, 'pr-8')}
              />
              <button
                type="button"
                onClick={() => setShowTokenPlain((v) => !v)}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                title={showTokenPlain ? 'Hide' : 'Show'}
              >
                {showTokenPlain ? (
                  <RiEyeOffLine className="size-3.5" />
                ) : (
                  <RiEyeLine className="size-3.5" />
                )}
              </button>
            </div>
            <button
              type="button"
              onClick={handleSaveToken}
              disabled={!tokenInput.trim()}
              className="shrink-0 rounded bg-primary px-3 py-1.5 text-xs text-primary-foreground disabled:opacity-50"
            >
              Save
            </button>
          </div>
        </div>
      ) : (
        <div className="flex items-center gap-2 text-xs">
          <RiCheckLine className="size-3 text-green-500" />
          <span className="text-muted-foreground">Token configured</span>
          <button
            type="button"
            onClick={() => setShowToken(!showToken)}
            className="text-primary text-[10px]"
          >
            {showToken ? 'Cancel' : 'Change'}
          </button>
          {showToken && (
            <div className="flex gap-2 flex-1">
              <input
                type="password"
                value={tokenInput}
                onChange={(e) => setTokenInput(e.target.value)}
                placeholder="New token"
                className={inputClass}
              />
              <button
                type="button"
                onClick={handleSaveToken}
                disabled={!tokenInput.trim()}
                className="rounded bg-primary px-2 py-1 text-[10px] text-primary-foreground disabled:opacity-50"
              >
                Update
              </button>
            </div>
          )}
        </div>
      )}

      {/* Discord-only: invite bot to server hint */}
      {conn.type === 'discord' && token && isConnected && (
        <div className="rounded-md border border-border/60 bg-muted/30 p-3 text-xs space-y-1.5">
          <div className="font-medium text-foreground flex items-center gap-1.5">
            <RiInformationLine className="size-3.5 text-primary" />
            Invite your bot to a server
          </div>
          {conn.discordGuilds && conn.discordGuilds.length > 0 ? (
            <>
              <div className="text-muted-foreground leading-snug">
                Bot is already in {conn.discordGuilds.length} server
                {conn.discordGuilds.length === 1 ? '' : 's'}:
              </div>
              <ul className="flex flex-wrap gap-1">
                {conn.discordGuilds.slice(0, 8).map((g) => (
                  <li
                    key={g.id}
                    className="rounded-full bg-background border border-border px-2 py-0.5 text-[10px] text-foreground"
                    title={`Guild ID: ${g.id}`}
                  >
                    {g.name}
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <div className="text-muted-foreground leading-snug">
              Your bot isn't in any server yet. Add it to your server so it can see channels:
            </div>
          )}
          {conn.discordInviteUrl ? (
            <a
              href={conn.discordInviteUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-primary text-[11px] hover:underline"
            >
              {conn.discordGuilds && conn.discordGuilds.length > 0
                ? 'Add to another server'
                : 'Open invite link'}{' '}
              <RiExternalLinkLine className="size-3" />
            </a>
          ) : (
            <button
              type="button"
              onClick={() => fetchDiscordInviteUrl()}
              className="text-primary text-[11px] hover:underline"
            >
              Generate invite link →
            </button>
          )}
          <div className="text-[10px] text-muted-foreground leading-snug">
            Required permissions: View Channel, Send Messages, Embed Links, Read Message History.
          </div>
        </div>
      )}

      {/* Step 2: Chat / Channel ID */}
      {token && (
        <div className="space-y-2">
          <div className="text-xs font-medium text-foreground flex items-center gap-2">
            {meta.targetLabel}
            {hasTarget && <RiCheckLine className="size-3 text-green-500" />}
          </div>
          {!hasTarget ? (
            <>
              <div className="text-[11px] text-muted-foreground leading-snug">
                {meta.targetHelp}
              </div>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={targetInput}
                  onChange={(e) => setTargetInput(e.target.value)}
                  placeholder={meta.targetPlaceholder}
                  className={inputClass}
                />
                <button
                  type="button"
                  onClick={handleSaveTarget}
                  disabled={!targetInput.trim()}
                  className="shrink-0 rounded bg-primary px-3 py-1.5 text-xs text-primary-foreground disabled:opacity-50"
                >
                  Save
                </button>
              </div>
            </>
          ) : (
            <div className="flex items-center gap-2 text-xs flex-wrap">
              <code className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-foreground">
                {target}
              </code>
              {conn.type === 'telegram' && conn.telegramChatTitle && (
                <span className="text-muted-foreground">
                  {conn.telegramChatTitle}
                  {conn.telegramChatType ? ` (${conn.telegramChatType})` : ''}
                </span>
              )}
              {conn.type === 'discord' && conn.discordChannelName && (
                <span className="text-muted-foreground">
                  #{conn.discordChannelName}
                  {conn.guildName ? ` · ${conn.guildName}` : ''}
                  {conn.discordChannelTypeLabel ? ` · ${conn.discordChannelTypeLabel}` : ''}
                </span>
              )}
              {conn.type === 'discord' && conn.botToken && conn.defaultChannelId && !conn.discordChannelName && (
                <button
                  type="button"
                  onClick={() => resolveDiscordChannel()}
                  className="text-primary text-[10px] hover:underline"
                  title="Look up channel info via Discord API"
                >
                  Look up
                </button>
              )}
              <button
                type="button"
                onClick={() => {
                  if (conn.type === 'discord') {
                    updateConnection('discord', {
                      defaultChannelId: undefined,
                      discordChannelName: undefined,
                      discordChannelType: undefined,
                      discordChannelTypeLabel: undefined,
                    });
                  } else {
                    updateConnection('telegram', {
                      telegramChatId: undefined,
                      telegramChatTitle: undefined,
                      telegramChatType: undefined,
                      telegramIsForum: undefined,
                    });
                  }
                }}
                className="text-primary text-[10px] hover:underline"
              >
                Change
              </button>
            </div>
          )}
        </div>
      )}

      {/* Step 3: Action buttons - the visible "what next" call to action */}
      {hasToken && hasTarget && (
        <div className="space-y-2 rounded-md border border-primary/20 bg-primary/5 p-3">
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => sendTestMessage(conn.type)}
              disabled={conn.lastSyncStatus === 'sending'}
              className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              {conn.lastSyncStatus === 'sending' ? (
                <RiLoader4Line className="size-3.5 animate-spin" />
              ) : (
                <RiSendPlaneLine className="size-3.5" />
              )}
              Send test message
            </button>
            <button
              type="button"
              onClick={() => sendSyncSummary(conn.type, buildSummary())}
              disabled={conn.lastSyncStatus === 'sending'}
              className="inline-flex items-center gap-1.5 rounded-md border border-primary/40 px-3 py-1.5 text-xs font-medium text-primary hover:bg-primary/10 disabled:opacity-50"
            >
              {conn.lastSyncStatus === 'sending' ? (
                <RiLoader4Line className="size-3.5 animate-spin" />
              ) : (
                <RiRefreshLine className="size-3.5" />
              )}
              Sync now
            </button>
            <div className="ml-auto text-[10px] text-muted-foreground">
              Last activity: {formatRelative(conn.lastSyncAt)}
            </div>
          </div>
          {conn.lastSyncMessage && (
            <div
              className={cn(
                'text-[11px] leading-snug',
                conn.lastSyncStatus === 'error' && 'text-destructive',
                conn.lastSyncStatus === 'ok' && 'text-green-600 dark:text-green-400',
                conn.lastSyncStatus === 'sending' && 'text-muted-foreground',
              )}
            >
              {conn.lastSyncMessage}
            </div>
          )}
        </div>
      )}

      {/* Sync mode */}
      <div className="space-y-1.5">
        <div className="text-xs font-medium text-foreground">Sync Mode</div>
        <div className="flex gap-1">
          {SYNC_MODES.map((mode) => (
            <button
              key={mode.id}
              type="button"
              onClick={() => updateConnection(conn.type, { syncMode: mode.id })}
              className={cn(
                'flex-1 rounded-md px-2 py-1.5 text-[10px] font-medium transition-colors',
                conn.syncMode === mode.id
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-muted text-muted-foreground hover:text-foreground',
              )}
              title={mode.desc}
            >
              {mode.label}
            </button>
          ))}
        </div>
        <div className="text-[10px] text-muted-foreground">
          {SYNC_MODES.find((m) => m.id === conn.syncMode)?.desc}
        </div>
      </div>

      {/* Sync options */}
      <div className="flex flex-wrap gap-3 text-xs">
        {(['syncProjects', 'syncTasks', 'syncSchedule', 'autoCreateThreads'] as const).map(
          (key) => (
            <label key={key} className="flex items-center gap-1.5 cursor-pointer">
              <input
                type="checkbox"
                checked={conn[key]}
                onChange={(e) => updateConnection(conn.type, { [key]: e.target.checked })}
                className="rounded border-border accent-primary"
              />
              <span className="text-muted-foreground">
                {key.replace(/([A-Z])/g, ' $1').replace('sync ', '').trim()}
              </span>
            </label>
          ),
        )}
      </div>

      {/* Project ↔ Channel mappings (advanced) */}
      {conn.syncProjects && projects.length > 0 && (
        <details className="group">
          <summary className="cursor-pointer text-xs font-medium text-foreground select-none">
            Project → {conn.type === 'discord' ? 'Channel' : 'Topic'} Mapping{' '}
            <span className="text-[10px] text-muted-foreground font-normal">(optional)</span>
          </summary>
          <div className="mt-2 space-y-2">
            {projects.slice(0, 10).map((project) => {
              const mapping = projectMappings.find((m) => m.projectId === project.id);
              const channelName =
                conn.type === 'discord'
                  ? mapping?.discord?.channelName
                  : mapping?.telegram?.topicName;
              return (
                <div key={project.id} className="flex items-center gap-2 text-xs">
                  <span className="text-foreground min-w-0 truncate flex-1">
                    {project.label || project.path.split('/').pop()}
                  </span>
                  <span className="text-muted-foreground">→</span>
                  <input
                    type="text"
                    value={channelName ?? ''}
                    onChange={(e) => {
                      const name = e.target.value;
                      const update = {
                        projectId: project.id,
                        projectLabel:
                          project.label || project.path.split('/').pop() || project.path,
                        ...(conn.type === 'discord'
                          ? { discord: { channelId: project.id, channelName: name } }
                          : { telegram: { topicId: project.id, topicName: name } }),
                      };
                      setProjectMapping(update);
                    }}
                    placeholder={`#${(project.label || project.path.split('/').pop() || '')
                      .toLowerCase()
                      .replace(/\s+/g, '-')}`}
                    className="w-32 rounded border border-border bg-background px-2 py-0.5 text-xs text-foreground"
                  />
                </div>
              );
            })}
          </div>
        </details>
      )}
    </div>
  );
}

export const MessengerSection: React.FC = () => {
  const connections = useMessengerStore((s) => s.connections);
  const startOnboarding = useMessengerStore((s) => s.startOnboarding);

  const availableTypes: MessengerType[] = useMemo(
    () =>
      (['discord', 'telegram'] as const).filter(
        (type) => !connections.some((c) => c.type === type),
      ),
    [connections],
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-medium text-foreground">Messenger Sync</h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            Push Otto task, project and schedule updates to Discord and Telegram.
          </p>
        </div>
      </div>

      {connections.map((conn) => (
        <ConnectionCard key={conn.type} conn={conn} />
      ))}

      {availableTypes.length > 0 && (
        <div className="flex gap-2">
          {availableTypes.map((type) => {
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
