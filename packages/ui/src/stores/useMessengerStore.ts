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

interface MessengerState {
  connections: MessengerConnection[];
  projectMappings: ProjectMessengerMapping[];
  onboardingStep: number | null;
  onboardingType: MessengerType | null;

  addConnection: (type: MessengerType) => void;
  updateConnection: (type: MessengerType, updates: Partial<MessengerConnection>) => void;
  removeConnection: (type: MessengerType) => void;
  testConnection: (type: MessengerType) => Promise<boolean>;
  resolveTelegramChat: () => Promise<boolean>;
  sendTestMessage: (type: MessengerType) => Promise<boolean>;
  sendSyncSummary: (type: MessengerType, summary: string) => Promise<boolean>;
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
            const res = await fetch('https://discord.com/api/v10/users/@me', {
              headers: { Authorization: `Bot ${conn.botToken}` },
            });
            if (!res.ok) throw new Error(`Discord API: ${res.status}`);
            const data = await res.json();
            get().updateConnection(type, {
              status: 'connected',
              lastConnectedAt: Date.now(),
              guildName: data.username ?? 'Connected',
            });
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
        })),
        projectMappings: state.projectMappings,
      }),
    },
  ),
);
