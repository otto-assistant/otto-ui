import React, { useEffect, useMemo, useState } from 'react';
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
  RiPlayCircleLine,
  RiStopCircleLine,
  RiChatSmile3Line,
  RiStethoscopeLine,
  RiErrorWarningLine,
} from '@remixicon/react';
import {
  useMessengerStore,
  type MessengerType,
  type MessengerConnection,
  type MessengerVerbosity,
  type SyncMode,
  type TelegramInboundMessage,
  type TelegramDiagnosisCheck,
  type MessengerInboundMessage,
  type MessengerApproval,
} from '@/stores/useMessengerStore';
import { useOttoEventsStore, type OttoUiRealtimeEvent } from '@/stores/useOttoEventsStore';
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

const VERBOSITY_OPTIONS: { id: MessengerVerbosity; label: string; desc: string }[] = [
  { id: 'quiet', label: 'Quiet', desc: 'Final answer only — hides reasoning and tool activity' },
  { id: 'normal', label: 'Normal', desc: 'Answer + thinking marker + compact tool one-liners' },
  {
    id: 'verbose',
    label: 'Verbose',
    desc: 'Everything, with full tool calls + results collapsed under spoilers',
  },
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

function formatRelative(ts: number | null | undefined): string {
  if (!ts) return 'never';
  const diff = Date.now() - ts;
  if (diff < 60_000) return 'just now';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return new Date(ts).toLocaleString();
}

function TelegramListenerPanel({
  conn,
  inbound,
  startListener,
  stopListener,
  refreshStatus,
  loadRecent,
  onToggleAutoReply,
}: {
  conn: MessengerConnection;
  inbound: TelegramInboundMessage[];
  startListener: () => Promise<boolean>;
  stopListener: () => Promise<boolean>;
  refreshStatus: () => Promise<void>;
  loadRecent: () => Promise<void>;
  onToggleAutoReply: (v: boolean) => void;
}) {
  const running = Boolean(conn.telegramListenerRunning);
  const autoReply = conn.telegramListenerAutoReply !== false;
  const subscribeToEvents = useOttoEventsStore((s) => s.subscribeToEvents);
  const ingestTelegramInbound = useMessengerStore((s) => s.ingestTelegramInbound);

  // Subscribe to realtime telegram message_received events so the UI updates
  // instantly when a new message arrives, without waiting for the next poll.
  useEffect(() => {
    if (!running) return;
    const handler = (event: OttoUiRealtimeEvent) => {
      if (event.eventType !== 'messenger.telegram.message_received') return;
      const data = event.data as TelegramInboundMessage | undefined;
      if (data && typeof data === 'object' && 'updateId' in data) {
        ingestTelegramInbound(data as TelegramInboundMessage);
      }
    };
    return subscribeToEvents(handler);
  }, [running, subscribeToEvents, ingestTelegramInbound]);

  // Refresh status + recent every 10s while listener is running (fallback when
  // WS isn't connected).
  useEffect(() => {
    if (!running) return;
    let cancelled = false;
    const tick = async () => {
      if (cancelled) return;
      await Promise.all([refreshStatus(), loadRecent()]);
    };
    tick();
    const id = setInterval(tick, 10_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [running, refreshStatus, loadRecent]);

  // On mount, fetch server-side status so reload reflects the real state.
  useEffect(() => {
    refreshStatus();
    loadRecent();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="rounded-md border border-border/60 bg-muted/30 p-3 space-y-3">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2 text-xs font-medium text-foreground">
          <RiChatSmile3Line className="size-4 text-primary" />
          Listen for incoming messages
          <span
            className={cn(
              'rounded-full px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wide',
              running
                ? 'bg-green-500/20 text-green-600 dark:text-green-400'
                : 'bg-muted text-muted-foreground',
            )}
          >
            {running ? 'live' : 'off'}
          </span>
        </div>
        <div className="flex items-center gap-2">
          {!running ? (
            <button
              type="button"
              onClick={() => startListener()}
              className="inline-flex items-center gap-1 rounded bg-primary px-2.5 py-1 text-[11px] font-medium text-primary-foreground hover:bg-primary/90"
            >
              <RiPlayCircleLine className="size-3.5" />
              Start listening
            </button>
          ) : (
            <button
              type="button"
              onClick={() => stopListener()}
              className="inline-flex items-center gap-1 rounded border border-destructive/40 px-2.5 py-1 text-[11px] font-medium text-destructive hover:bg-destructive/10"
            >
              <RiStopCircleLine className="size-3.5" />
              Stop
            </button>
          )}
          <label className="flex items-center gap-1 text-[10px] text-muted-foreground cursor-pointer">
            <input
              type="checkbox"
              checked={autoReply}
              onChange={(e) => onToggleAutoReply(e.target.checked)}
              className="rounded border-border accent-primary"
            />
            Auto-reply
          </label>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-2 text-[10px]">
        <div className="rounded bg-background border border-border px-2 py-1.5">
          <div className="text-muted-foreground">Received</div>
          <div className="text-foreground font-medium">
            {conn.telegramListenerTotalReceived ?? 0}
          </div>
        </div>
        <div className="rounded bg-background border border-border px-2 py-1.5">
          <div className="text-muted-foreground">Replied</div>
          <div className="text-foreground font-medium">
            {conn.telegramListenerTotalReplied ?? 0}
          </div>
        </div>
        <div className="rounded bg-background border border-border px-2 py-1.5">
          <div className="text-muted-foreground">Last update</div>
          <div className="text-foreground font-medium">
            {formatRelative(conn.telegramListenerLastUpdateAt ?? null)}
          </div>
        </div>
      </div>

      {conn.telegramListenerError && (
        <div className="text-[11px] text-destructive flex items-start gap-1.5">
          <RiAlertLine className="size-3.5 shrink-0 mt-0.5" />
          {conn.telegramListenerError}
        </div>
      )}

      {!running ? (
        <div className="text-[11px] text-muted-foreground leading-snug">
          Start the listener so Otto can answer messages sent to the bot. While running,
          incoming messages appear below, and the auto-reply confirms each round-trip.
          Open Telegram → message your bot → send <code className="bg-muted px-1 rounded">/start</code>{' '}
          or any text. You'll see it here within seconds.
        </div>
      ) : inbound.length === 0 ? (
        <div className="text-[11px] text-muted-foreground italic">
          Waiting for messages… Send your bot a message in Telegram to test.
        </div>
      ) : (
        <ul className="space-y-1.5 max-h-48 overflow-y-auto">
          {inbound.slice(0, 8).map((m) => (
            <li
              key={m.updateId}
              className="rounded bg-background border border-border px-2 py-1.5 text-[11px] space-y-0.5"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium text-foreground truncate">
                  {m.from?.firstName ?? m.from?.username ?? 'Unknown'}
                  {m.from?.username ? (
                    <span className="text-muted-foreground"> @{m.from.username}</span>
                  ) : null}
                </span>
                <span className="text-[9px] text-muted-foreground shrink-0">
                  {new Date(m.receivedAt).toLocaleTimeString()}
                </span>
              </div>
              <div className="text-muted-foreground break-words">
                {m.text ?? <em>(non-text message)</em>}
              </div>
              <div className="text-[9px] text-muted-foreground">
                {m.chatTitle ?? `chat ${m.chatId}`}
                {m.threadId ? ` · topic ${m.threadId}` : ''}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function TelegramWarnings({ conn }: { conn: MessengerConnection }) {
  const warnings: { id: string; severity: 'warn' | 'info'; title: string; detail: string }[] = [];

  if (conn.telegramBotCanReadAllGroupMessages === false) {
    warnings.push({
      id: 'privacy',
      severity: 'warn',
      title: 'Privacy mode is ON — bot will not see plain group messages',
      detail:
        'By default Telegram filters out every message that is not a /command, @mention or reply. Open @BotFather → /setprivacy → choose your bot → Disable, then remove and re-add the bot to the group.',
    });
  }
  if (conn.telegramChatId && conn.telegramIsForum === false) {
    const isPrivate = conn.telegramChatType === 'private';
    warnings.push({
      id: 'forum',
      severity: isPrivate ? 'info' : 'warn',
      title: isPrivate
        ? 'This is a private DM — per-project topics are not supported'
        : 'This chat does not have Topics enabled — sync will post a single summary message',
      detail: isPrivate
        ? 'Otto will post one summary message here. Use a supergroup with Topics to get one topic per project.'
        : 'Per-project topics require a supergroup with Topics enabled. In the group → Manage Group → Topics → enable.',
    });
  }

  if (warnings.length === 0) return null;
  return (
    <div className="space-y-2">
      {warnings.map((w) => (
        <div
          key={w.id}
          className={cn(
            'rounded-md border px-3 py-2 text-[11px] flex items-start gap-2',
            w.severity === 'warn'
              ? 'border-yellow-500/30 bg-yellow-500/10 text-yellow-800 dark:text-yellow-300'
              : 'border-border bg-muted/40 text-muted-foreground',
          )}
        >
          <RiErrorWarningLine className="size-3.5 shrink-0 mt-0.5" />
          <div>
            <div className="font-medium">{w.title}</div>
            <div className="leading-snug mt-0.5">{w.detail}</div>
          </div>
        </div>
      ))}
    </div>
  );
}

function severityClass(s: TelegramDiagnosisCheck['severity']) {
  if (s === 'ok') return 'text-green-600 dark:text-green-400';
  if (s === 'warn') return 'text-yellow-600 dark:text-yellow-400';
  if (s === 'error') return 'text-destructive';
  return 'text-muted-foreground';
}

function TelegramDiagnosePanel({
  conn,
  diagnosis,
  running,
  runDiagnose,
}: {
  conn: MessengerConnection;
  diagnosis: ReturnType<typeof useMessengerStore.getState>['telegramDiagnosis'];
  running: boolean;
  runDiagnose: () => Promise<boolean>;
}) {
  const hasIssue = diagnosis?.checks?.some((c) => !c.ok) ?? false;

  return (
    <div className="rounded-md border border-border/60 bg-muted/30 p-3 space-y-2">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2 text-xs font-medium text-foreground">
          <RiStethoscopeLine className="size-4 text-primary" />
          Diagnose
          {diagnosis && (
            <span
              className={cn(
                'rounded-full px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wide',
                hasIssue
                  ? 'bg-yellow-500/20 text-yellow-700 dark:text-yellow-300'
                  : 'bg-green-500/20 text-green-700 dark:text-green-400',
              )}
            >
              {hasIssue ? 'issues' : 'all clear'}
            </span>
          )}
        </div>
        <button
          type="button"
          onClick={() => runDiagnose()}
          disabled={running}
          className="inline-flex items-center gap-1 rounded bg-primary px-2.5 py-1 text-[11px] font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
        >
          {running ? (
            <RiLoader4Line className="size-3.5 animate-spin" />
          ) : (
            <RiStethoscopeLine className="size-3.5" />
          )}
          {running ? 'Running…' : diagnosis ? 'Re-run diagnose' : 'Run diagnose'}
        </button>
      </div>
      {!diagnosis && (
        <div className="text-[11px] text-muted-foreground leading-snug">
          Diagnose calls Telegram's API on your behalf to verify the token, privacy mode, chat
          access, forum status and the bot's admin rights. Use it whenever sync or auto-reply
          doesn't work as expected.
        </div>
      )}
      {diagnosis && diagnosis.checks.length > 0 && (
        <ul className="space-y-1.5">
          {diagnosis.checks.map((c) => (
            <li key={c.id} className="rounded bg-background border border-border px-2 py-1.5">
              <div className="flex items-start gap-1.5">
                <span className={cn('text-xs leading-none mt-0.5', severityClass(c.severity))}>
                  {c.severity === 'ok' ? '✓' : c.severity === 'warn' ? '⚠' : c.severity === 'error' ? '✗' : 'ⓘ'}
                </span>
                <div className="flex-1 min-w-0">
                  <div className={cn('text-[11px] font-medium', severityClass(c.severity))}>
                    {c.title}
                  </div>
                  <div className="text-[10px] text-muted-foreground leading-snug mt-0.5 break-words">
                    {c.detail}
                  </div>
                  {c.fix && (
                    <div className="text-[10px] text-foreground leading-snug mt-1">
                      <span className="font-medium">Fix: </span>
                      {c.fix}
                    </div>
                  )}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
      {diagnosis && (
        <div className="text-[10px] text-muted-foreground">
          Last run {formatRelative(diagnosis.runAt)} for token of @{conn.telegramBotUsername ?? 'bot'}.
        </div>
      )}
    </div>
  );
}

function TelegramSyncResults({
  topics,
  postedTo,
}: {
  topics: NonNullable<MessengerConnection['lastSyncTopics']>;
  postedTo: 'forum' | 'chat';
}) {
  return (
    <div className="rounded-md border border-border/60 bg-muted/30 p-3 space-y-2">
      <div className="text-xs font-medium text-foreground flex items-center gap-1.5">
        <RiCheckLine className="size-3.5 text-primary" />
        Last sync result{' '}
        <span className="text-[10px] font-normal text-muted-foreground">
          ({postedTo === 'forum' ? 'forum topics' : 'main chat'})
        </span>
      </div>
      <ul className="space-y-1">
        {topics.map((t) => (
          <li
            key={t.projectId}
            className="rounded bg-background border border-border px-2 py-1.5 text-[11px] flex items-start gap-2"
          >
            <span
              className={cn(
                'mt-0.5',
                t.error
                  ? 'text-destructive'
                  : t.created
                    ? 'text-green-600 dark:text-green-400'
                    : 'text-muted-foreground',
              )}
            >
              {t.error ? '✗' : t.created ? '✓ new' : '·'}
            </span>
            <div className="flex-1 min-w-0">
              <div className="font-medium text-foreground truncate">
                {t.projectLabel}{' '}
                <span className="text-muted-foreground font-normal">
                  → {t.topicName}
                  {t.topicId ? ` (topic ${t.topicId})` : ''}
                </span>
              </div>
              {t.error && (
                <div className="text-destructive leading-snug">{t.error}</div>
              )}
              {!t.error && t.messageId && (
                <div className="text-[10px] text-muted-foreground">
                  message {t.messageId} sent
                </div>
              )}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

function DiscordListenerPanel({
  conn,
  inbound,
  history,
  startListener,
  stopListener,
  refreshStatus,
  loadRecent,
  loadHistory,
  onToggleAutoReply,
}: {
  conn: MessengerConnection;
  inbound: MessengerInboundMessage[];
  history: ReturnType<typeof useMessengerStore.getState>['discordHistory'];
  startListener: () => Promise<boolean>;
  stopListener: () => Promise<boolean>;
  refreshStatus: () => Promise<void>;
  loadRecent: () => Promise<void>;
  loadHistory: (channelId: string, limit?: number) => Promise<boolean>;
  onToggleAutoReply: (v: boolean) => void;
}) {
  const running = Boolean(conn.discordListenerRunning);
  const connected = Boolean(conn.discordListenerConnected);
  const autoReply = conn.discordListenerAutoReply !== false;
  const subscribeToEvents = useOttoEventsStore((s) => s.subscribeToEvents);
  const ingestDiscordInbound = useMessengerStore((s) => s.ingestDiscordInbound);

  useEffect(() => {
    if (!running) return;
    const handler = (event: OttoUiRealtimeEvent) => {
      if (event.eventType !== 'messenger.discord.message_received') return;
      const data = event.data as MessengerInboundMessage | undefined;
      if (data && typeof data === 'object' && 'updateId' in data) {
        ingestDiscordInbound(data);
      }
    };
    return subscribeToEvents(handler);
  }, [running, subscribeToEvents, ingestDiscordInbound]);

  useEffect(() => {
    if (!running) return;
    let cancelled = false;
    const tick = async () => {
      if (cancelled) return;
      await Promise.all([refreshStatus(), loadRecent()]);
    };
    tick();
    const id = setInterval(tick, 10_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [running, refreshStatus, loadRecent]);

  useEffect(() => {
    refreshStatus();
    loadRecent();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const historyTarget = conn.defaultChannelId;

  return (
    <div className="rounded-md border border-border/60 bg-muted/30 p-3 space-y-3">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2 text-xs font-medium text-foreground">
          <RiChatSmile3Line className="size-4 text-primary" />
          Listen for incoming messages
          <span
            className={cn(
              'rounded-full px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wide',
              connected
                ? 'bg-green-500/20 text-green-600 dark:text-green-400'
                : running
                  ? 'bg-yellow-500/20 text-yellow-600 dark:text-yellow-400'
                  : 'bg-muted text-muted-foreground',
            )}
          >
            {connected ? 'live' : running ? 'connecting…' : 'off'}
          </span>
        </div>
        <div className="flex items-center gap-2">
          {!running ? (
            <button
              type="button"
              onClick={() => startListener()}
              className="inline-flex items-center gap-1 rounded bg-primary px-2.5 py-1 text-[11px] font-medium text-primary-foreground hover:bg-primary/90"
            >
              <RiPlayCircleLine className="size-3.5" />
              Start listening
            </button>
          ) : (
            <button
              type="button"
              onClick={() => stopListener()}
              className="inline-flex items-center gap-1 rounded border border-destructive/40 px-2.5 py-1 text-[11px] font-medium text-destructive hover:bg-destructive/10"
            >
              <RiStopCircleLine className="size-3.5" />
              Stop
            </button>
          )}
          <label className="flex items-center gap-1 text-[10px] text-muted-foreground cursor-pointer">
            <input
              type="checkbox"
              checked={autoReply}
              onChange={(e) => onToggleAutoReply(e.target.checked)}
              className="rounded border-border accent-primary"
            />
            Auto-reply
          </label>
          <label
            className="flex items-center gap-1 text-[10px] text-muted-foreground cursor-pointer"
            title="When on, only messages from the saved Server (Guild) ID reach the UI. When off (default) every message the bot can see is forwarded."
          >
            <input
              type="checkbox"
              checked={Boolean(conn.discordListenerScopeToGuild)}
              onChange={(e) =>
                useMessengerStore
                  .getState()
                  .updateConnection('discord', { discordListenerScopeToGuild: e.target.checked })
              }
              className="rounded border-border accent-primary"
            />
            Scope to saved server
          </label>
        </div>
      </div>

      <div className="grid grid-cols-4 gap-2 text-[10px]">
        <div className="rounded bg-background border border-border px-2 py-1.5">
          <div className="text-muted-foreground">Gateway saw</div>
          <div className="text-foreground font-medium">
            {conn.discordListenerTotalRawMessages ?? 0}
          </div>
        </div>
        <div className="rounded bg-background border border-border px-2 py-1.5">
          <div className="text-muted-foreground">Forwarded</div>
          <div className="text-foreground font-medium">
            {conn.discordListenerTotalReceived ?? 0}
          </div>
        </div>
        <div className="rounded bg-background border border-border px-2 py-1.5">
          <div className="text-muted-foreground">Replied</div>
          <div className="text-foreground font-medium">
            {conn.discordListenerTotalReplied ?? 0}
          </div>
        </div>
        <div className="rounded bg-background border border-border px-2 py-1.5">
          <div className="text-muted-foreground">Last update</div>
          <div className="text-foreground font-medium">
            {formatRelative(conn.discordListenerLastUpdateAt ?? null)}
          </div>
        </div>
      </div>

      {/* Loud diagnostic when the saved guild ID doesn't match the guild the
          gateway is actually delivering messages from — common root cause of
          "the bot doesn't reply to my messages". */}
      {(conn.discordListenerFilteredOutCount ?? 0) > 0 &&
        conn.discordListenerScopeToGuild &&
        conn.discordListenerLastFilteredGuildId &&
        conn.discordListenerLastFilteredGuildId !== conn.discordGuildId && (
          <div className="rounded-md border border-yellow-500/30 bg-yellow-500/10 px-3 py-2 text-[11px] text-yellow-800 dark:text-yellow-300 flex items-start gap-2 leading-snug">
            <RiAlertLine className="size-3.5 shrink-0 mt-0.5" />
            <div>
              <div className="font-medium">
                Filtered out {conn.discordListenerFilteredOutCount} message
                {conn.discordListenerFilteredOutCount === 1 ? '' : 's'} from guild{' '}
                <code className="bg-muted px-1 rounded">{conn.discordListenerLastFilteredGuildId}</code>
              </div>
              <div className="mt-0.5">
                The listener is scoped to your saved Server ID (
                <code className="bg-muted px-1 rounded">{conn.discordGuildId}</code>) but the bot
                is also hearing from another server. Update the Server ID, or turn off
                "Scope to saved server" below.
              </div>
            </div>
          </div>
        )}

      {/* Hint when the gateway is connected but no messages have arrived yet —
          either the bot has no channel access, or MESSAGE_CONTENT is off. */}
      {connected && (conn.discordListenerTotalRawMessages ?? 0) === 0 && (
        <div className="rounded-md border border-border/60 bg-muted/40 px-3 py-2 text-[11px] text-muted-foreground leading-snug">
          Gateway connected — IDENTIFY accepted. Post a message in a channel the bot can see to
          confirm end-to-end. If nothing arrives:
          (1) the bot must have <em>View Channel</em> on that channel,
          (2) <em>Message Content</em> intent must be enabled in the Developer Portal, then
          restart the listener for the new intent to apply.
        </div>
      )}

      {conn.discordListenerError && (
        <div className="text-[11px] text-destructive flex items-start gap-1.5 leading-snug">
          <RiAlertLine className="size-3.5 shrink-0 mt-0.5" />
          {conn.discordListenerError}
        </div>
      )}

      {!running ? (
        <div className="text-[11px] text-muted-foreground leading-snug">
          Start the listener so Otto can answer messages sent to the bot. Otto opens a
          Discord Gateway WebSocket and listens to <code className="bg-muted px-1 rounded">MESSAGE_CREATE</code>{' '}
          and <code className="bg-muted px-1 rounded">INTERACTION_CREATE</code> (button clicks). You'll need to{' '}
          enable <em>Message Content Intent</em> in the Developer Portal for the bot to see the body of
          non-mention messages.
        </div>
      ) : inbound.length === 0 ? (
        <div className="text-[11px] text-muted-foreground italic">
          Waiting for messages… Mention or DM the bot in your server.
        </div>
      ) : (
        <ul className="space-y-1.5 max-h-48 overflow-y-auto">
          {inbound.slice(0, 8).map((m) => (
            <li
              key={String(m.updateId)}
              className="rounded bg-background border border-border px-2 py-1.5 text-[11px] space-y-0.5"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium text-foreground truncate">
                  {m.from?.firstName ?? m.from?.username ?? 'Unknown'}
                  {m.from?.username ? (
                    <span className="text-muted-foreground"> @{m.from.username}</span>
                  ) : null}
                </span>
                <span className="text-[9px] text-muted-foreground shrink-0">
                  {new Date(m.receivedAt).toLocaleTimeString()}
                </span>
              </div>
              <div className="text-muted-foreground break-words">
                {m.text ?? <em>(non-text message)</em>}
              </div>
              <div className="text-[9px] text-muted-foreground">
                channel {m.chatId}
                {m.discord?.guildId ? ` · guild ${m.discord.guildId}` : ''}
              </div>
            </li>
          ))}
        </ul>
      )}

      {/* History fetch — only works on Discord; Telegram bots cannot fetch
          pre-listener-start history due to a fundamental Bot API limitation. */}
      <div className="border-t border-border/60 pt-2 space-y-1.5">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div className="text-[11px] font-medium text-foreground">Channel history</div>
          <button
            type="button"
            onClick={() => historyTarget && loadHistory(historyTarget, 50)}
            disabled={!historyTarget}
            className="rounded bg-primary/10 px-2 py-0.5 text-[10px] text-primary hover:bg-primary/20 disabled:opacity-50"
          >
            Fetch last 50
          </button>
        </div>
        {!historyTarget && (
          <div className="text-[10px] text-muted-foreground">
            Save a default Channel ID to enable history fetch.
          </div>
        )}
        {historyTarget && history.length === 0 && (
          <div className="text-[10px] text-muted-foreground italic">
            No history loaded yet — click "Fetch last 50".
          </div>
        )}
        {history.length > 0 && (
          <ul className="space-y-1 max-h-40 overflow-y-auto">
            {history.slice(0, 10).map((m) => (
              <li
                key={m.id}
                className="rounded bg-background border border-border px-2 py-1 text-[10px]"
              >
                <span className="font-medium text-foreground">
                  {m.author.globalName ?? m.author.username ?? m.author.id}
                </span>{' '}
                <span className="text-[9px] text-muted-foreground">
                  {new Date(m.timestamp).toLocaleTimeString()}
                </span>
                <div className="text-muted-foreground break-words">
                  {m.content || <em>(no text — {m.attachmentCount} attachment{m.attachmentCount === 1 ? '' : 's'})</em>}
                </div>
              </li>
            ))}
            {history.length > 10 && (
              <li className="text-[10px] text-muted-foreground italic px-2">
                + {history.length - 10} older message{history.length - 10 === 1 ? '' : 's'}
              </li>
            )}
          </ul>
        )}
      </div>
    </div>
  );
}

function DiscordDiagnosePanel({
  conn,
  diagnosis,
  running,
  runDiagnose,
}: {
  conn: MessengerConnection;
  diagnosis: ReturnType<typeof useMessengerStore.getState>['discordDiagnosis'];
  running: boolean;
  runDiagnose: () => Promise<boolean>;
}) {
  const hasIssue = diagnosis?.checks?.some((c) => !c.ok && c.severity !== 'info') ?? false;
  return (
    <div className="rounded-md border border-border/60 bg-muted/30 p-3 space-y-2">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2 text-xs font-medium text-foreground">
          <RiStethoscopeLine className="size-4 text-primary" />
          Diagnose
          {diagnosis && (
            <span
              className={cn(
                'rounded-full px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wide',
                hasIssue
                  ? 'bg-yellow-500/20 text-yellow-700 dark:text-yellow-300'
                  : 'bg-green-500/20 text-green-700 dark:text-green-400',
              )}
            >
              {hasIssue ? 'issues' : 'all clear'}
            </span>
          )}
        </div>
        <button
          type="button"
          onClick={() => runDiagnose()}
          disabled={running}
          className="inline-flex items-center gap-1 rounded bg-primary px-2.5 py-1 text-[11px] font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
        >
          {running ? (
            <RiLoader4Line className="size-3.5 animate-spin" />
          ) : (
            <RiStethoscopeLine className="size-3.5" />
          )}
          {running ? 'Running…' : diagnosis ? 'Re-run diagnose' : 'Run diagnose'}
        </button>
      </div>
      {!diagnosis && (
        <div className="text-[11px] text-muted-foreground leading-snug">
          Diagnose validates token, server access, default channel posting permissions, and
          flags the Message Content intent requirement for the gateway listener.
        </div>
      )}
      {diagnosis && diagnosis.checks.length > 0 && (
        <ul className="space-y-1.5">
          {diagnosis.checks.map((c) => (
            <li key={c.id} className="rounded bg-background border border-border px-2 py-1.5">
              <div className="flex items-start gap-1.5">
                <span className={cn('text-xs leading-none mt-0.5', severityClass(c.severity))}>
                  {c.severity === 'ok' ? '✓' : c.severity === 'warn' ? '⚠' : c.severity === 'error' ? '✗' : 'ⓘ'}
                </span>
                <div className="flex-1 min-w-0">
                  <div className={cn('text-[11px] font-medium', severityClass(c.severity))}>
                    {c.title}
                  </div>
                  <div className="text-[10px] text-muted-foreground leading-snug mt-0.5 break-words">
                    {c.detail}
                  </div>
                  {c.fix && (
                    <div className="text-[10px] text-foreground leading-snug mt-1">
                      <span className="font-medium">Fix: </span>
                      {c.fix}
                    </div>
                  )}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
      {diagnosis && (
        <div className="text-[10px] text-muted-foreground">
          Last run {formatRelative(diagnosis.runAt)} for {conn.discordBotUsername ? `bot ${conn.discordBotUsername}` : 'this bot'}.
        </div>
      )}
    </div>
  );
}

function ApprovalsPanel({
  type,
  approvals,
  onSendDemo,
}: {
  type: MessengerType;
  approvals: MessengerApproval[];
  onSendDemo: () => Promise<MessengerApproval | null>;
}) {
  const subscribeToEvents = useOttoEventsStore((s) => s.subscribeToEvents);
  const ingestApprovalDecision = useMessengerStore((s) => s.ingestApprovalDecision);
  const [sending, setSending] = useState(false);

  useEffect(() => {
    const handler = (event: OttoUiRealtimeEvent) => {
      const wanted =
        type === 'telegram'
          ? 'messenger.telegram.approval'
          : 'messenger.discord.approval';
      if (event.eventType !== wanted) return;
      const d = event.data as
        | {
            approvalId: string;
            decision: 'approve' | 'deny';
            by?: { username?: string | null; firstName?: string | null; displayName?: string | null };
          }
        | undefined;
      if (!d?.approvalId || !d.decision) return;
      const byName =
        d.by?.displayName || d.by?.firstName || d.by?.username || null;
      ingestApprovalDecision(d.approvalId, d.decision, byName);
    };
    return subscribeToEvents(handler);
  }, [type, subscribeToEvents, ingestApprovalDecision]);

  return (
    <div className="rounded-md border border-border/60 bg-muted/30 p-3 space-y-2">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="text-xs font-medium text-foreground flex items-center gap-1.5">
          <RiCheckLine className="size-3.5 text-primary" />
          Approve actions
          <span className="text-[10px] font-normal text-muted-foreground">
            ({approvals.filter((a) => !a.decision && !a.error).length} pending)
          </span>
        </div>
        <button
          type="button"
          onClick={async () => {
            setSending(true);
            try {
              await onSendDemo();
            } finally {
              setSending(false);
            }
          }}
          disabled={sending}
          className="inline-flex items-center gap-1 rounded bg-primary/10 px-2.5 py-1 text-[11px] font-medium text-primary hover:bg-primary/20 disabled:opacity-50"
        >
          {sending ? <RiLoader4Line className="size-3.5 animate-spin" /> : <RiSendPlaneLine className="size-3.5" />}
          Send approval request
        </button>
      </div>
      <div className="text-[11px] text-muted-foreground leading-snug">
        Otto can post a message with Approve / Deny buttons. When you (or someone in the chat)
        click a button, the listener pipes the decision back here in real time.
      </div>
      {approvals.length === 0 ? (
        <div className="text-[11px] text-muted-foreground italic">
          No approval requests sent yet. Click "Send approval request" to try it.
        </div>
      ) : (
        <ul className="space-y-1">
          {approvals.slice(0, 5).map((a) => (
            <li
              key={a.id}
              className="rounded bg-background border border-border px-2 py-1.5 text-[11px] space-y-0.5"
            >
              <div className="flex items-center justify-between gap-2">
                <span
                  className={cn(
                    'font-medium',
                    a.decision === 'approve'
                      ? 'text-green-600 dark:text-green-400'
                      : a.decision === 'deny'
                        ? 'text-destructive'
                        : a.error
                          ? 'text-destructive'
                          : 'text-yellow-600 dark:text-yellow-400',
                  )}
                >
                  {a.decision
                    ? a.decision === 'approve'
                      ? `✓ Approved by ${a.decidedBy ?? 'user'}`
                      : `✗ Denied by ${a.decidedBy ?? 'user'}`
                    : a.error
                      ? '✗ Failed to send'
                      : '⏳ Waiting for response'}
                </span>
                <span className="text-[9px] text-muted-foreground shrink-0">
                  {formatRelative(a.decidedAt ?? a.sentAt)}
                </span>
              </div>
              <div className="text-muted-foreground break-words">{a.prompt}</div>
              {a.error && <div className="text-destructive">{a.error}</div>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function BridgePanel({
  conn,
  type,
  bridgeStatus,
  refreshBridgeStatus,
  onToggle,
}: {
  conn: MessengerConnection;
  type: MessengerType;
  bridgeStatus: ReturnType<typeof useMessengerStore.getState>['bridgeStatus'];
  refreshBridgeStatus: (t?: MessengerType) => Promise<void>;
  onToggle: (v: boolean) => void;
}) {
  const enabled = conn.bridgeEnabled !== false;
  const bridgeVerbosity = useMessengerStore((s) => s.bridgeVerbosity);
  const setBridgeVerbosity = useMessengerStore((s) => s.setBridgeVerbosity);
  useEffect(() => {
    refreshBridgeStatus(type);
    const id = setInterval(() => refreshBridgeStatus(type), 8000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [type]);

  const bindings = bridgeStatus.bindings.filter((b) => b.type === type);
  const active = bridgeStatus.active.filter((a) => a.type === type);
  const currentVerbosity: MessengerVerbosity = bridgeVerbosity[type] ?? 'normal';

  return (
    <div className="rounded-md border border-primary/30 bg-primary/5 p-3 space-y-2">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2 text-xs font-medium text-foreground">
          <RiChatSmile3Line className="size-4 text-primary" />
          OpenCode bridge
          <span
            className={cn(
              'rounded-full px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wide',
              bridgeStatus.enabled && enabled
                ? 'bg-green-500/20 text-green-700 dark:text-green-400'
                : 'bg-muted text-muted-foreground',
            )}
          >
            {!bridgeStatus.enabled ? 'unavailable' : enabled ? 'on' : 'off'}
          </span>
        </div>
        <label className="flex items-center gap-1 text-[10px] text-muted-foreground cursor-pointer">
          <input
            type="checkbox"
            checked={enabled}
            disabled={!bridgeStatus.enabled}
            onChange={(e) => onToggle(e.target.checked)}
            className="rounded border-border accent-primary"
          />
          Forward messages to OpenCode
        </label>
      </div>
      <div className="text-[11px] text-muted-foreground leading-snug">
        When on, every non-command message posted to a{' '}
        {type === 'telegram' ? 'chat / topic' : 'channel'} is forwarded to an OpenCode session
        in the matching project's directory. The bridge{' '}
        <strong>auto-resolves project ↔ {type === 'telegram' ? 'chat' : 'channel'}</strong> by
        slug-matching the {type === 'telegram' ? 'chat title' : 'channel name'} against your
        project labels — no manual mapping needed. OpenCode's streaming response is edited back
        into the same {type === 'telegram' ? 'chat' : 'channel'}, so the conversation is shared
        with the web UI. (Manual mapping is still available below if you want a specific
        override; restart the listener after toggling.)
      </div>
      {!bridgeStatus.enabled && (
        <div className="text-[10px] text-yellow-700 dark:text-yellow-400">
          The web server reports the bridge is unavailable — OpenCode may not be reachable yet.
        </div>
      )}

      {/* Output verbosity — how much of each OpenCode turn is mirrored back.
          Mirrors the in-chat `/verbosity` command; the per-conversation
          `/verbosity <level>` override always wins over this default. */}
      <div className="space-y-1.5 border-t border-border/60 pt-2">
        <div className="text-[11px] font-medium text-foreground">Output verbosity</div>
        <div className="flex gap-1">
          {VERBOSITY_OPTIONS.map((opt) => (
            <button
              key={opt.id}
              type="button"
              onClick={() => setBridgeVerbosity(type, opt.id)}
              disabled={!bridgeStatus.enabled}
              className={cn(
                'flex-1 rounded-md px-2 py-1.5 text-[10px] font-medium transition-colors disabled:opacity-50',
                currentVerbosity === opt.id
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-muted text-muted-foreground hover:text-foreground',
              )}
              title={opt.desc}
            >
              {opt.label}
            </button>
          ))}
        </div>
        <div className="text-[10px] text-muted-foreground leading-snug">
          {VERBOSITY_OPTIONS.find((o) => o.id === currentVerbosity)?.desc}. Change it from{' '}
          {type === 'telegram' ? 'the chat' : 'Discord'} too with{' '}
          <code className="bg-muted px-1 rounded">/verbosity {currentVerbosity}</code> (this
          conversation) or <code className="bg-muted px-1 rounded">/verbosity default verbose</code>{' '}
          (everywhere). At <strong>Verbose</strong>, every tool call and result is posted under a
          click-to-reveal spoiler.
        </div>
      </div>

      {bindings.length > 0 && (
        <div className="space-y-1">
          <div className="text-[10px] font-medium text-foreground">
            Channel ↔ session bindings ({bindings.length})
          </div>
          <ul className="space-y-0.5 max-h-32 overflow-y-auto">
            {bindings.slice(0, 8).map((b) => (
              <li
                key={`${b.type}:${b.targetKey}:${b.sessionId}`}
                className="text-[10px] text-muted-foreground"
              >
                <code className="bg-muted px-1 rounded">{b.targetKey}</code> →{' '}
                <code className="bg-muted px-1 rounded">{b.sessionId.slice(0, 16)}…</code>
                {b.projectLabel ? ` · ${b.projectLabel}` : ''}
              </li>
            ))}
          </ul>
        </div>
      )}
      {active.length > 0 && (
        <div className="text-[10px] text-muted-foreground">
          <span className="text-primary">▶</span> {active.length} prompt
          {active.length === 1 ? '' : 's'} streaming…
        </div>
      )}
    </div>
  );
}

function DiscordSyncResults({
  channels,
  guildName,
}: {
  channels: NonNullable<MessengerConnection['lastSyncChannels']>;
  guildName?: string;
}) {
  return (
    <div className="rounded-md border border-border/60 bg-muted/30 p-3 space-y-2">
      <div className="text-xs font-medium text-foreground flex items-center gap-1.5">
        <RiCheckLine className="size-3.5 text-primary" />
        Last sync result{' '}
        {guildName && (
          <span className="text-[10px] font-normal text-muted-foreground">({guildName})</span>
        )}
      </div>
      <ul className="space-y-1">
        {channels.map((c) => {
          const channelOk = !c.error && Boolean(c.messageId);
          const threadAsked = c.threadRequested !== false;
          // Status icon priority: channel-failed > thread-failed-but-channel-ok > all-ok > nothing-done
          const iconState = c.error
            ? 'channel-error'
            : threadAsked && c.threadError
              ? 'thread-error'
              : c.created
                ? 'new'
                : channelOk
                  ? 'reused'
                  : 'idle';
          return (
            <li
              key={c.projectId}
              className="rounded bg-background border border-border px-2 py-1.5 text-[11px] flex items-start gap-2"
            >
              <span
                className={cn(
                  'mt-0.5',
                  iconState === 'channel-error' && 'text-destructive',
                  iconState === 'thread-error' && 'text-yellow-600 dark:text-yellow-400',
                  iconState === 'new' && 'text-green-600 dark:text-green-400',
                  (iconState === 'reused' || iconState === 'idle') && 'text-muted-foreground',
                )}
              >
                {iconState === 'channel-error'
                  ? '✗'
                  : iconState === 'thread-error'
                    ? '⚠'
                    : iconState === 'new'
                      ? '✓ new'
                      : '·'}
              </span>
              <div className="flex-1 min-w-0">
                <div className="font-medium text-foreground truncate">
                  {c.projectLabel}{' '}
                  <span className="text-muted-foreground font-normal">
                    → {c.channelName ? `#${c.channelName}` : '(no channel)'}
                    {c.threadId ? ` › ${c.threadName ?? 'thread'}` : ''}
                  </span>
                </div>
                {channelOk && (
                  <div className="text-[10px] text-muted-foreground">
                    message {c.messageId} sent
                    {c.threadCreated
                      ? ' · thread opened'
                      : threadAsked
                        ? ' · thread NOT opened'
                        : ''}
                  </div>
                )}
                {c.error && (
                  <div className="text-destructive leading-snug">{c.error}</div>
                )}
                {!c.error && c.threadError && (
                  <div className="text-yellow-700 dark:text-yellow-400 leading-snug">
                    Thread skipped — {c.threadError}
                  </div>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function ConnectionCard({ conn }: { conn: MessengerConnection }) {
  const updateConnection = useMessengerStore((s) => s.updateConnection);
  const testConnection = useMessengerStore((s) => s.testConnection);
  const removeConnection = useMessengerStore((s) => s.removeConnection);
  const resolveTelegramChat = useMessengerStore((s) => s.resolveTelegramChat);
  const resolveDiscordChannel = useMessengerStore((s) => s.resolveDiscordChannel);
  const resolveDiscordGuild = useMessengerStore((s) => s.resolveDiscordGuild);
  const syncDiscordGuildProjects = useMessengerStore((s) => s.syncDiscordGuildProjects);
  const fetchDiscordInviteUrl = useMessengerStore((s) => s.fetchDiscordInviteUrl);
  const sendTestMessage = useMessengerStore((s) => s.sendTestMessage);
  const sendSyncSummary = useMessengerStore((s) => s.sendSyncSummary);
  const syncTelegramProjects = useMessengerStore((s) => s.syncTelegramProjects);
  const startTelegramListener = useMessengerStore((s) => s.startTelegramListener);
  const stopTelegramListener = useMessengerStore((s) => s.stopTelegramListener);
  const refreshTelegramListenerStatus = useMessengerStore((s) => s.refreshTelegramListenerStatus);
  const loadRecentTelegramMessages = useMessengerStore((s) => s.loadRecentTelegramMessages);
  const telegramInbound = useMessengerStore((s) => s.telegramInbound);
  const diagnoseTelegram = useMessengerStore((s) => s.diagnoseTelegram);
  const telegramDiagnosis = useMessengerStore((s) => s.telegramDiagnosis);
  const telegramDiagnosisRunning = useMessengerStore((s) => s.telegramDiagnosisRunning);
  const diagnoseDiscord = useMessengerStore((s) => s.diagnoseDiscord);
  const discordDiagnosis = useMessengerStore((s) => s.discordDiagnosis);
  const discordDiagnosisRunning = useMessengerStore((s) => s.discordDiagnosisRunning);
  const refreshBridgeStatus = useMessengerStore((s) => s.refreshBridgeStatus);
  const bridgeStatus = useMessengerStore((s) => s.bridgeStatus);
  const startDiscordListener = useMessengerStore((s) => s.startDiscordListener);
  const stopDiscordListener = useMessengerStore((s) => s.stopDiscordListener);
  const refreshDiscordListenerStatus = useMessengerStore((s) => s.refreshDiscordListenerStatus);
  const loadRecentDiscordMessages = useMessengerStore((s) => s.loadRecentDiscordMessages);
  const discordInbound = useMessengerStore((s) => s.discordInbound);
  const discordHistory = useMessengerStore((s) => s.discordHistory);
  const loadDiscordHistory = useMessengerStore((s) => s.loadDiscordHistory);
  const sendApprovalRequest = useMessengerStore((s) => s.sendApprovalRequest);
  const approvals = useMessengerStore((s) => s.approvals);
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
  const [guildInput, setGuildInput] = useState('');

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

  const buildProjectPayloads = (): { id: string; label: string; body: string }[] => {
    const now = new Date().toLocaleString();
    return projects.map((p) => {
      const label = p.label || p.path.split('/').pop() || p.path;
      const projectTasks = tasks.filter(
        (t) => t.projectId === p.id || t.projectPath === p.path,
      );
      const open = projectTasks.filter(
        (t) => t.status !== 'done' && t.status !== 'cancelled',
      );
      const done = projectTasks.filter((t) => t.status === 'done');
      const next = projectTasks
        .filter((t) => t.dueAt && t.status !== 'done' && t.status !== 'cancelled')
        .sort((a, b) => Date.parse(a.dueAt!) - Date.parse(b.dueAt!))
        .slice(0, 3);
      const lines = [
        `🤖 Otto sync — ${label}`,
        '',
        `• Open tasks: ${open.length}`,
        `• Done: ${done.length}`,
      ];
      if (next.length > 0) {
        lines.push('', 'Upcoming:');
        for (const t of next) {
          const when = t.dueAt ? new Date(t.dueAt).toLocaleString() : '';
          lines.push(`• ${t.title}${when ? ` — ${when}` : ''}`);
        }
      }
      lines.push('', `Last synced ${now}`);
      return { id: p.id, label, body: lines.join('\n') };
    });
  };

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
            done={hasTarget || (conn.type === 'discord' && Boolean(conn.discordGuildId))}
            label={
              conn.type === 'telegram'
                ? '3. Add chat ID'
                : '3. Add Server ID (or single channel ID)'
            }
            hint={
              hasTarget
                ? conn.type === 'telegram'
                  ? (conn.telegramChatTitle ?? conn.telegramChatId)
                  : conn.discordChannelName
                    ? `#${conn.discordChannelName}${conn.guildName ? ` (${conn.guildName})` : ''}`
                    : conn.defaultChannelId
                : conn.type === 'discord' && conn.discordGuildId
                  ? `${conn.guildName ?? conn.discordGuildId} · ${conn.discordGuildChannels?.length ?? 0} channel${(conn.discordGuildChannels?.length ?? 0) === 1 ? '' : 's'}`
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
            Required permissions: View Channel, Send Messages, Embed Links, Read Message History,
            and (for server-wide sync) Manage Channels + Manage Threads.
          </div>
        </div>
      )}

      {/* Discord-only: server (guild) ID for server-wide sync.
          Rendered as soon as the token is saved so users see the option
          before verify succeeds (resolve-guild itself surfaces bad-token errors). */}
      {conn.type === 'discord' && token && (
        <div className="rounded-md border border-primary/20 bg-primary/5 p-3 text-xs space-y-2">
          <div className="font-medium text-foreground flex items-center gap-1.5">
            <RiDiscordLine className="size-3.5 text-[#5865F2]" />
            Server (Guild) ID
            <span className="text-[10px] font-normal text-muted-foreground">
              — for server-wide sync
            </span>
            {conn.discordGuildId && <RiCheckLine className="size-3 text-green-500" />}
          </div>
          {!conn.discordGuildId ? (
            <>
              <div className="text-[11px] text-muted-foreground leading-snug">
                Paste the Discord <strong>server ID</strong> (right-click the server name in the
                channel list → "Copy Server ID" with Developer Mode on) to let Otto sync to every
                channel + thread on that server. With this set,{' '}
                <strong>Sync now</strong> will find-or-create one channel per Otto project under
                an optional category and start a thread per project for details.
              </div>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={guildInput}
                  onChange={(e) => setGuildInput(e.target.value)}
                  placeholder="e.g. 1234567890123456789"
                  className={inputClass}
                />
                <button
                  type="button"
                  onClick={() => {
                    const v = guildInput.trim();
                    if (!v) return;
                    updateConnection('discord', { discordGuildId: v });
                    setGuildInput('');
                    setTimeout(() => resolveDiscordGuild(), 0);
                  }}
                  disabled={!guildInput.trim()}
                  className="shrink-0 rounded bg-primary px-3 py-1.5 text-xs text-primary-foreground disabled:opacity-50"
                >
                  Save
                </button>
              </div>
              {conn.discordGuilds && conn.discordGuilds.length > 0 && (
                <div className="text-[10px] text-muted-foreground">
                  Quick pick from servers the bot is already in:
                  <div className="flex flex-wrap gap-1 mt-1">
                    {conn.discordGuilds.slice(0, 6).map((g) => (
                      <button
                        key={g.id}
                        type="button"
                        onClick={() => {
                          updateConnection('discord', { discordGuildId: g.id, guildName: g.name });
                          setTimeout(() => resolveDiscordGuild(), 0);
                        }}
                        className="rounded-full bg-background border border-border px-2 py-0.5 text-foreground hover:border-primary/40"
                        title={g.id}
                      >
                        {g.name}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </>
          ) : (
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-xs flex-wrap">
                <code className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-foreground">
                  {conn.discordGuildId}
                </code>
                {conn.guildName && (
                  <span className="text-muted-foreground">{conn.guildName}</span>
                )}
                {typeof conn.discordGuildChannels !== 'undefined' && (
                  <span className="text-muted-foreground">
                    · {conn.discordGuildChannels.length} channel
                    {conn.discordGuildChannels.length === 1 ? '' : 's'}
                    {conn.discordGuildCategories && conn.discordGuildCategories.length > 0
                      ? ` · ${conn.discordGuildCategories.length} categor${conn.discordGuildCategories.length === 1 ? 'y' : 'ies'}`
                      : ''}
                    {typeof conn.discordGuildActiveThreadCount === 'number'
                      ? ` · ${conn.discordGuildActiveThreadCount} active thread${conn.discordGuildActiveThreadCount === 1 ? '' : 's'}`
                      : ''}
                  </span>
                )}
                <button
                  type="button"
                  onClick={() => resolveDiscordGuild()}
                  className="text-primary text-[10px] hover:underline"
                  title="Re-fetch server channel topology"
                >
                  Re-scan
                </button>
                <button
                  type="button"
                  onClick={() =>
                    updateConnection('discord', {
                      discordGuildId: undefined,
                      discordGuildChannels: undefined,
                      discordGuildCategories: undefined,
                      discordGuildActiveThreadCount: undefined,
                      discordParentCategoryId: undefined,
                    })
                  }
                  className="text-primary text-[10px] hover:underline"
                >
                  Change
                </button>
              </div>

              {/* Category picker */}
              {conn.discordGuildCategories && conn.discordGuildCategories.length > 0 && (
                <div className="flex items-center gap-2 text-[11px]">
                  <label htmlFor={`cat-${conn.type}`} className="text-muted-foreground">
                    Parent category:
                  </label>
                  <select
                    id={`cat-${conn.type}`}
                    value={conn.discordParentCategoryId ?? ''}
                    onChange={(e) =>
                      updateConnection('discord', {
                        discordParentCategoryId: e.target.value || undefined,
                      })
                    }
                    className="rounded border border-border bg-background px-2 py-0.5 text-foreground text-[11px]"
                  >
                    <option value="">(none — root of server)</option>
                    {conn.discordGuildCategories.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              <label className="flex items-center gap-1.5 text-[11px] cursor-pointer">
                <input
                  type="checkbox"
                  checked={conn.discordCreateThreads !== false}
                  onChange={(e) =>
                    updateConnection('discord', { discordCreateThreads: e.target.checked })
                  }
                  className="rounded border-border accent-primary"
                />
                <span className="text-muted-foreground">
                  Start a thread from each project status message
                </span>
              </label>
            </div>
          )}
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

      {/* Step 3: Action buttons - the visible "what next" call to action.
          For Discord, server-id alone also unlocks the CTA (Sync now works with just guildId). */}
      {hasToken && (hasTarget || (conn.type === 'discord' && conn.discordGuildId)) && (
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
              onClick={() => {
                if (conn.type === 'telegram') {
                  // Per-project sync that also creates forum topics when applicable.
                  syncTelegramProjects(buildProjectPayloads(), buildSummary());
                } else if (conn.type === 'discord' && conn.discordGuildId) {
                  // Server-wide sync: per-project channel + thread.
                  syncDiscordGuildProjects(buildProjectPayloads(), buildSummary());
                } else {
                  sendSyncSummary(conn.type, buildSummary());
                }
              }}
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

      {/* Telegram inline warnings — explain real Telegram pitfalls before the user clicks Sync now */}
      {conn.type === 'telegram' && hasToken && isConnected && (
        <TelegramWarnings conn={conn} />
      )}

      {/* OpenCode bridge — when on, the listeners route inbound messages
          through OpenCode and stream the response back. This is what turns
          the messenger into a real OpenChamber chat surface, instead of the
          legacy "Otto received: ..." ping echo. */}
      {hasToken && (hasTarget || (conn.type === 'discord' && conn.discordGuildId)) && (
        <BridgePanel
          conn={conn}
          type={conn.type}
          bridgeStatus={bridgeStatus}
          refreshBridgeStatus={refreshBridgeStatus}
          onToggle={(v) => updateConnection(conn.type, { bridgeEnabled: v })}
        />
      )}

      {/* Telegram inbound listener */}
      {conn.type === 'telegram' && hasToken && hasTarget && (
        <TelegramListenerPanel
          conn={conn}
          inbound={telegramInbound}
          startListener={startTelegramListener}
          stopListener={stopTelegramListener}
          refreshStatus={refreshTelegramListenerStatus}
          loadRecent={loadRecentTelegramMessages}
          onToggleAutoReply={(v) =>
            updateConnection('telegram', { telegramListenerAutoReply: v })
          }
        />
      )}

      {/* Telegram diagnose + per-topic sync results */}
      {conn.type === 'telegram' && hasToken && (
        <TelegramDiagnosePanel
          conn={conn}
          diagnosis={telegramDiagnosis}
          running={telegramDiagnosisRunning}
          runDiagnose={diagnoseTelegram}
        />
      )}

      {conn.type === 'telegram' && conn.lastSyncTopics && conn.lastSyncTopics.length > 0 && (
        <TelegramSyncResults
          topics={conn.lastSyncTopics}
          postedTo={conn.lastSyncPostedTo ?? 'forum'}
        />
      )}

      {/* Discord Gateway listener + history (parity with Telegram listener) */}
      {conn.type === 'discord' && hasToken && (conn.discordGuildId || conn.defaultChannelId) && (
        <DiscordListenerPanel
          conn={conn}
          inbound={discordInbound}
          history={discordHistory}
          startListener={startDiscordListener}
          stopListener={stopDiscordListener}
          refreshStatus={refreshDiscordListenerStatus}
          loadRecent={loadRecentDiscordMessages}
          loadHistory={loadDiscordHistory}
          onToggleAutoReply={(v) =>
            updateConnection('discord', { discordListenerAutoReply: v })
          }
        />
      )}

      {/* Discord diagnose (parity with Telegram) */}
      {conn.type === 'discord' && hasToken && (
        <DiscordDiagnosePanel
          conn={conn}
          diagnosis={discordDiagnosis}
          running={discordDiagnosisRunning}
          runDiagnose={diagnoseDiscord}
        />
      )}

      {conn.type === 'discord' && conn.lastSyncChannels && conn.lastSyncChannels.length > 0 && (
        <DiscordSyncResults channels={conn.lastSyncChannels} guildName={conn.guildName} />
      )}

      {/* Approval requests panel — shared by both messengers, only rendered when
          this card has a usable target. */}
      {hasToken && (hasTarget || (conn.type === 'discord' && conn.discordGuildId)) && (
        <ApprovalsPanel
          type={conn.type}
          approvals={approvals.filter((a) => a.type === conn.type)}
          onSendDemo={() =>
            sendApprovalRequest(
              conn.type,
              'Approve project sync run? This is a demo request from the Otto settings page.',
            )
          }
        />
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
