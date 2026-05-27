import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { getSafeStorage } from './utils/safeStorage';

export type MessengerType = 'discord' | 'telegram';
export type SyncMode = 'full' | 'notifications' | 'off';

export interface MessengerConnection {
  type: MessengerType;
  enabled: boolean;
  status: 'disconnected' | 'connecting' | 'connected' | 'error';
  error: string | null;
  lastConnectedAt: number | null;

  // Discord-specific
  botToken?: string;
  guildId?: string;
  guildName?: string;
  /** Default Discord channel id that summary / test messages are sent to. */
  defaultChannelId?: string;
  discordBotId?: string;
  discordBotUsername?: string;
  discordBotDiscriminator?: string;
  discordChannelName?: string;
  discordChannelType?: number;
  discordChannelTypeLabel?: string;
  discordGuilds?: { id: string; name: string }[];
  /** Cached invite URL built from discordBotId so the user can re-invite the bot. */
  discordInviteUrl?: string;
  webhookSecret?: string;

  // Telegram-specific
  telegramBotToken?: string;
  /** Telegram chat id (negative number for groups, e.g. -1001234567890). */
  telegramChatId?: string;
  telegramChatTitle?: string;
  telegramChatType?: string;
  telegramIsForum?: boolean;
  telegramBotUsername?: string;

  // Last activity (test message / sync now)
  lastSyncAt: number | null;
  lastSyncStatus: 'idle' | 'sending' | 'ok' | 'error';
  lastSyncMessage: string | null;

  // Telegram long-poll listener state (set after start/status calls)
  telegramListenerRunning?: boolean;
  telegramListenerStartedAt?: number | null;
  telegramListenerLastUpdateAt?: number | null;
  telegramListenerTotalReceived?: number;
  telegramListenerTotalReplied?: number;
  telegramListenerError?: string | null;
  telegramListenerAutoReply?: boolean;

  // Sync config
  syncMode: SyncMode;
  syncProjects: boolean;
  syncTasks: boolean;
  syncSchedule: boolean;
  autoCreateThreads: boolean;
}

export interface ProjectMessengerMapping {
  projectId: string;
  projectLabel: string;
  discord?: { channelId: string; channelName: string };
  telegram?: { topicId: string; topicName: string };
}

export interface TelegramInboundMessage {
  updateId: number;
  chatId: number | string;
  chatTitle: string | null;
  chatType: string | null;
  threadId: number | null;
  from:
    | {
        id: number;
        username: string | null;
        firstName: string | null;
        isBot: boolean;
      }
    | null;
  text: string | null;
  receivedAt: string;
}

interface MessengerState {
  connections: MessengerConnection[];
  projectMappings: ProjectMessengerMapping[];
  onboardingStep: number | null;
  onboardingType: MessengerType | null;

  /** In-memory ring buffer of recent inbound Telegram messages (newest first). */
  telegramInbound: TelegramInboundMessage[];

  addConnection: (type: MessengerType) => void;
  updateConnection: (type: MessengerType, updates: Partial<MessengerConnection>) => void;
  removeConnection: (type: MessengerType) => void;
  testConnection: (type: MessengerType) => Promise<boolean>;
  resolveTelegramChat: () => Promise<boolean>;
  resolveDiscordChannel: () => Promise<boolean>;
  fetchDiscordInviteUrl: () => Promise<string | null>;
  sendTestMessage: (type: MessengerType) => Promise<boolean>;
  sendSyncSummary: (type: MessengerType, summary: string) => Promise<boolean>;
  syncTelegramProjects: (
    projects: { id: string; label: string; body: string }[],
    summary: string,
  ) => Promise<boolean>;
  startTelegramListener: () => Promise<boolean>;
  stopTelegramListener: () => Promise<boolean>;
  refreshTelegramListenerStatus: () => Promise<void>;
  loadRecentTelegramMessages: () => Promise<void>;
  ingestTelegramInbound: (msg: TelegramInboundMessage) => void;
  setProjectMapping: (mapping: ProjectMessengerMapping) => void;
  removeProjectMapping: (projectId: string) => void;
  startOnboarding: (type: MessengerType) => void;
  nextOnboardingStep: () => void;
  finishOnboarding: () => void;
}

const DEFAULT_CONNECTION: Omit<MessengerConnection, 'type'> = {
  enabled: false,
  status: 'disconnected',
  error: null,
  lastConnectedAt: null,
  lastSyncAt: null,
  lastSyncStatus: 'idle',
  lastSyncMessage: null,
  syncMode: 'full',
  syncProjects: true,
  syncTasks: true,
  syncSchedule: true,
  autoCreateThreads: true,
};

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return (await res.json()) as T;
}

export const useMessengerStore = create<MessengerState>()(
  persist(
    (set, get) => ({
      connections: [],
      projectMappings: [],
      onboardingStep: null,
      onboardingType: null,
      telegramInbound: [],

      addConnection: (type) => {
        const existing = get().connections.find((c) => c.type === type);
        if (existing) return;
        set({ connections: [...get().connections, { ...DEFAULT_CONNECTION, type }] });
      },

      updateConnection: (type, updates) => {
        set({
          connections: get().connections.map((c) =>
            c.type === type ? { ...c, ...updates } : c,
          ),
        });
      },

      removeConnection: (type) => {
        set({
          connections: get().connections.filter((c) => c.type !== type),
          projectMappings: get().projectMappings.map((m) => {
            const next = { ...m };
            if (type === 'discord') delete next.discord;
            if (type === 'telegram') delete next.telegram;
            return next;
          }),
        });
      },

      testConnection: async (type) => {
        const conn = get().connections.find((c) => c.type === type);
        if (!conn) return false;

        get().updateConnection(type, { status: 'connecting', error: null });

        try {
          if (type === 'discord' && conn.botToken) {
            // Route through backend so we also get guild list + bot id in one call.
            const data = await postJson<{
              ok: boolean;
              error?: string;
              id?: string;
              username?: string;
              discriminator?: string;
              guilds?: { id: string; name: string }[];
            }>('/api/otto/messenger/test', { type: 'discord', token: conn.botToken });
            if (!data.ok) throw new Error(data.error ?? 'Discord API failed');
            get().updateConnection(type, {
              status: 'connected',
              lastConnectedAt: Date.now(),
              discordBotId: data.id,
              discordBotUsername: data.username,
              discordBotDiscriminator: data.discriminator,
              discordGuilds: data.guilds ?? [],
              guildName: data.guilds && data.guilds.length > 0 ? data.guilds[0].name : undefined,
            });
            // Best-effort: pre-fetch the invite URL so the user can re-invite if needed.
            if (data.id) {
              get().fetchDiscordInviteUrl();
            }
            return true;
          }

          if (type === 'telegram' && conn.telegramBotToken) {
            const res = await fetch(
              `https://api.telegram.org/bot${conn.telegramBotToken}/getMe`,
            );
            if (!res.ok) throw new Error(`Telegram API: ${res.status}`);
            const data = await res.json();
            if (!data.ok) throw new Error(data.description ?? 'Invalid token');
            get().updateConnection(type, {
              status: 'connected',
              lastConnectedAt: Date.now(),
              telegramBotUsername: data.result?.username,
            });
            return true;
          }

          throw new Error('No token configured');
        } catch (e) {
          get().updateConnection(type, {
            status: 'error',
            error: e instanceof Error ? e.message : 'Connection failed',
          });
          return false;
        }
      },

      resolveDiscordChannel: async () => {
        const conn = get().connections.find((c) => c.type === 'discord');
        if (!conn?.botToken || !conn.defaultChannelId) return false;
        try {
          const data = await postJson<{
            ok: boolean;
            error?: string;
            channelName?: string | null;
            channelType?: number;
            channelTypeLabel?: string;
            guildId?: string | null;
            guildName?: string | null;
          }>('/api/otto/messenger/discord/resolve-channel', {
            token: conn.botToken,
            channelId: conn.defaultChannelId,
          });
          if (!data.ok) {
            get().updateConnection('discord', { error: data.error ?? 'Could not resolve channel' });
            return false;
          }
          get().updateConnection('discord', {
            discordChannelName: data.channelName ?? undefined,
            discordChannelType: data.channelType,
            discordChannelTypeLabel: data.channelTypeLabel,
            guildId: data.guildId ?? undefined,
            guildName: data.guildName ?? undefined,
            error: null,
          });
          return true;
        } catch (e) {
          get().updateConnection('discord', {
            error: e instanceof Error ? e.message : 'resolve-channel failed',
          });
          return false;
        }
      },

      fetchDiscordInviteUrl: async () => {
        const conn = get().connections.find((c) => c.type === 'discord');
        if (!conn?.discordBotId) return null;
        try {
          const data = await postJson<{ ok: boolean; url?: string; error?: string }>(
            '/api/otto/messenger/discord/invite-url',
            { clientId: conn.discordBotId },
          );
          if (!data.ok || !data.url) return null;
          get().updateConnection('discord', { discordInviteUrl: data.url });
          return data.url;
        } catch {
          return null;
        }
      },

      resolveTelegramChat: async () => {
        const conn = get().connections.find((c) => c.type === 'telegram');
        if (!conn?.telegramBotToken || !conn.telegramChatId) return false;

        try {
          const data = await postJson<{
            ok: boolean;
            error?: string;
            title?: string | null;
            type?: string | null;
            isForum?: boolean;
            chatId?: number | string;
          }>('/api/otto/messenger/telegram/resolve-chat', {
            token: conn.telegramBotToken,
            chatId: conn.telegramChatId,
          });
          if (!data.ok) {
            get().updateConnection('telegram', {
              error: data.error ?? 'Could not resolve chat',
            });
            return false;
          }
          get().updateConnection('telegram', {
            telegramChatTitle: data.title ?? undefined,
            telegramChatType: data.type ?? undefined,
            telegramIsForum: Boolean(data.isForum),
            error: null,
          });
          return true;
        } catch (e) {
          get().updateConnection('telegram', {
            error: e instanceof Error ? e.message : 'resolve-chat failed',
          });
          return false;
        }
      },

      sendTestMessage: async (type) => {
        const conn = get().connections.find((c) => c.type === type);
        if (!conn) return false;

        const token = type === 'discord' ? conn.botToken : conn.telegramBotToken;
        const target = type === 'discord' ? conn.defaultChannelId : conn.telegramChatId;
        if (!token || !target) {
          get().updateConnection(type, {
            lastSyncStatus: 'error',
            lastSyncMessage:
              type === 'telegram'
                ? 'Add your Telegram chat ID before sending'
                : 'Add a Discord channel ID before sending',
          });
          return false;
        }

        get().updateConnection(type, {
          lastSyncStatus: 'sending',
          lastSyncMessage: 'Sending test message…',
        });

        const text =
          type === 'telegram'
            ? `✅ Otto is connected.\nThis is a test message from your Otto assistant.\n\nFrom now on Otto can post project, task and schedule updates to this chat.`
            : `**Otto connected ✓**\nThis is a test message from your Otto assistant.\nOtto can now post project, task and schedule updates to this channel.`;

        try {
          const data = await postJson<{ ok: boolean; error?: string }>(
            '/api/otto/messenger/send',
            { type, token, target, text },
          );
          if (!data.ok) {
            get().updateConnection(type, {
              lastSyncStatus: 'error',
              lastSyncMessage: data.error ?? 'Send failed',
            });
            return false;
          }
          get().updateConnection(type, {
            lastSyncAt: Date.now(),
            lastSyncStatus: 'ok',
            lastSyncMessage: 'Test message delivered ✓',
          });
          return true;
        } catch (e) {
          get().updateConnection(type, {
            lastSyncStatus: 'error',
            lastSyncMessage: e instanceof Error ? e.message : 'Send failed',
          });
          return false;
        }
      },

      sendSyncSummary: async (type, summary) => {
        const conn = get().connections.find((c) => c.type === type);
        if (!conn) return false;
        const token = type === 'discord' ? conn.botToken : conn.telegramBotToken;
        const target = type === 'discord' ? conn.defaultChannelId : conn.telegramChatId;
        if (!token || !target) {
          get().updateConnection(type, {
            lastSyncStatus: 'error',
            lastSyncMessage:
              type === 'telegram'
                ? 'Add your Telegram chat ID first'
                : 'Add a Discord channel ID first',
          });
          return false;
        }
        get().updateConnection(type, {
          lastSyncStatus: 'sending',
          lastSyncMessage: 'Sending sync summary…',
        });
        try {
          const data = await postJson<{ ok: boolean; error?: string }>(
            '/api/otto/messenger/send',
            { type, token, target, text: summary },
          );
          if (!data.ok) {
            get().updateConnection(type, {
              lastSyncStatus: 'error',
              lastSyncMessage: data.error ?? 'Sync failed',
            });
            return false;
          }
          get().updateConnection(type, {
            lastSyncAt: Date.now(),
            lastSyncStatus: 'ok',
            lastSyncMessage: 'Sync summary sent ✓',
          });
          return true;
        } catch (e) {
          get().updateConnection(type, {
            lastSyncStatus: 'error',
            lastSyncMessage: e instanceof Error ? e.message : 'Sync failed',
          });
          return false;
        }
      },

      syncTelegramProjects: async (projects, summary) => {
        const conn = get().connections.find((c) => c.type === 'telegram');
        if (!conn?.telegramBotToken || !conn.telegramChatId) {
          get().updateConnection('telegram', {
            lastSyncStatus: 'error',
            lastSyncMessage: 'Add Telegram bot token and chat ID first',
          });
          return false;
        }

        get().updateConnection('telegram', {
          lastSyncStatus: 'sending',
          lastSyncMessage:
            conn.telegramIsForum && projects.length > 0
              ? `Creating ${projects.length} topic${projects.length === 1 ? '' : 's'}…`
              : 'Sending sync summary…',
        });

        try {
          const data = await postJson<{
            ok: boolean;
            postedTo?: 'forum' | 'chat';
            error?: string;
            topics?: {
              projectId: string;
              projectLabel: string;
              topicId: string | null;
              topicName: string;
              messageId: number | null;
              created: boolean;
              error: string | null;
            }[];
          }>('/api/otto/messenger/telegram/sync-projects', {
            token: conn.telegramBotToken,
            chatId: conn.telegramChatId,
            isForum: Boolean(conn.telegramIsForum),
            summary,
            projects,
            mappings: get().projectMappings,
          });

          if (!data.ok && (!data.topics || data.topics.length === 0)) {
            get().updateConnection('telegram', {
              lastSyncStatus: 'error',
              lastSyncMessage: data.error ?? 'Sync failed',
            });
            return false;
          }

          // Persist newly-created topic ids back into project mappings.
          const newTopics = (data.topics ?? []).filter(
            (t) => t.topicId && !t.error,
          );
          for (const t of newTopics) {
            get().setProjectMapping({
              projectId: t.projectId,
              projectLabel: t.projectLabel,
              telegram: { topicId: String(t.topicId), topicName: t.topicName },
            });
          }

          const errored = (data.topics ?? []).filter((t) => t.error);
          const createdCount = (data.topics ?? []).filter((t) => t.created).length;
          const postedCount = (data.topics ?? []).filter((t) => t.messageId).length;

          let summaryMsg: string;
          if (data.postedTo === 'forum') {
            const parts = [];
            if (createdCount > 0) parts.push(`${createdCount} topic${createdCount === 1 ? '' : 's'} created`);
            if (postedCount > 0) parts.push(`${postedCount} message${postedCount === 1 ? '' : 's'} sent`);
            if (errored.length > 0) parts.push(`${errored.length} error${errored.length === 1 ? '' : 's'}`);
            summaryMsg = parts.length > 0 ? parts.join(', ') + ' ✓' : 'Sync sent ✓';
          } else {
            summaryMsg = 'Sync summary sent ✓';
          }

          get().updateConnection('telegram', {
            lastSyncAt: Date.now(),
            lastSyncStatus: errored.length > 0 ? 'error' : 'ok',
            lastSyncMessage:
              errored.length > 0
                ? `${summaryMsg} — first error: ${errored[0].error}`
                : summaryMsg,
          });
          return errored.length === 0;
        } catch (e) {
          get().updateConnection('telegram', {
            lastSyncStatus: 'error',
            lastSyncMessage: e instanceof Error ? e.message : 'Sync failed',
          });
          return false;
        }
      },

      startTelegramListener: async () => {
        const conn = get().connections.find((c) => c.type === 'telegram');
        if (!conn?.telegramBotToken) return false;
        try {
          const data = await postJson<{
            ok: boolean;
            running?: boolean;
            startedAt?: number;
            autoReply?: boolean;
            lastUpdateAt?: number | null;
            totalReceived?: number;
            totalReplied?: number;
            lastError?: string | null;
          }>('/api/otto/messenger/telegram/listener/start', {
            token: conn.telegramBotToken,
            autoReply: conn.telegramListenerAutoReply !== false,
          });
          if (!data.ok) return false;
          get().updateConnection('telegram', {
            telegramListenerRunning: data.running ?? true,
            telegramListenerStartedAt: data.startedAt ?? Date.now(),
            telegramListenerLastUpdateAt: data.lastUpdateAt ?? null,
            telegramListenerTotalReceived: data.totalReceived ?? 0,
            telegramListenerTotalReplied: data.totalReplied ?? 0,
            telegramListenerError: data.lastError ?? null,
            telegramListenerAutoReply: data.autoReply ?? true,
          });
          return true;
        } catch (e) {
          get().updateConnection('telegram', {
            telegramListenerError: e instanceof Error ? e.message : 'start failed',
            telegramListenerRunning: false,
          });
          return false;
        }
      },

      stopTelegramListener: async () => {
        const conn = get().connections.find((c) => c.type === 'telegram');
        if (!conn?.telegramBotToken) return false;
        try {
          await postJson('/api/otto/messenger/telegram/listener/stop', {
            token: conn.telegramBotToken,
          });
          get().updateConnection('telegram', {
            telegramListenerRunning: false,
          });
          return true;
        } catch (e) {
          get().updateConnection('telegram', {
            telegramListenerError: e instanceof Error ? e.message : 'stop failed',
          });
          return false;
        }
      },

      refreshTelegramListenerStatus: async () => {
        const conn = get().connections.find((c) => c.type === 'telegram');
        if (!conn?.telegramBotToken) return;
        try {
          const data = await postJson<{
            ok: boolean;
            running?: boolean;
            startedAt?: number;
            autoReply?: boolean;
            lastUpdateAt?: number | null;
            totalReceived?: number;
            totalReplied?: number;
            lastError?: string | null;
          }>('/api/otto/messenger/telegram/listener/status', {
            token: conn.telegramBotToken,
          });
          if (!data.ok) return;
          get().updateConnection('telegram', {
            telegramListenerRunning: data.running ?? false,
            telegramListenerStartedAt: data.startedAt ?? null,
            telegramListenerLastUpdateAt: data.lastUpdateAt ?? null,
            telegramListenerTotalReceived: data.totalReceived ?? 0,
            telegramListenerTotalReplied: data.totalReplied ?? 0,
            telegramListenerError: data.lastError ?? null,
            telegramListenerAutoReply: data.autoReply ?? true,
          });
        } catch {
          // ignore — background poll
        }
      },

      loadRecentTelegramMessages: async () => {
        const conn = get().connections.find((c) => c.type === 'telegram');
        if (!conn?.telegramBotToken) return;
        try {
          const data = await postJson<{
            ok: boolean;
            running?: boolean;
            messages?: TelegramInboundMessage[];
          }>('/api/otto/messenger/telegram/listener/recent', {
            token: conn.telegramBotToken,
            limit: 25,
          });
          if (data.ok && Array.isArray(data.messages)) {
            set({ telegramInbound: data.messages });
          }
        } catch {
          // ignore
        }
      },

      ingestTelegramInbound: (msg) => {
        const cur = get().telegramInbound;
        // Dedupe by updateId; keep newest first; cap at 50.
        const next = [msg, ...cur.filter((m) => m.updateId !== msg.updateId)].slice(0, 50);
        set({ telegramInbound: next });
      },

      setProjectMapping: (mapping) => {
        set({
          projectMappings: [
            ...get().projectMappings.filter((m) => m.projectId !== mapping.projectId),
            mapping,
          ],
        });
      },

      removeProjectMapping: (projectId) => {
        set({
          projectMappings: get().projectMappings.filter((m) => m.projectId !== projectId),
        });
      },

      startOnboarding: (type) => {
        get().addConnection(type);
        set({ onboardingStep: 0, onboardingType: type });
      },

      nextOnboardingStep: () => {
        const step = get().onboardingStep;
        if (step !== null) set({ onboardingStep: step + 1 });
      },

      finishOnboarding: () => {
        set({ onboardingStep: null, onboardingType: null });
      },
    }),
    {
      name: 'otto-messenger-config',
      storage: createJSONStorage(() => getSafeStorage()),
      partialize: (state) => ({
        connections: state.connections.map((c) => ({
          ...c,
          status: 'disconnected' as const,
          error: null,
          lastSyncStatus: 'idle' as const,
          lastSyncMessage: null,
          // Listener state lives on the server — clear it so the UI re-syncs after reload.
          telegramListenerRunning: false,
          telegramListenerStartedAt: null,
          telegramListenerLastUpdateAt: null,
          telegramListenerError: null,
        })),
        projectMappings: state.projectMappings,
      }),
    },
  ),
);
