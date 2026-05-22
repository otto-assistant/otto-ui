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
  webhookSecret?: string;

  // Telegram-specific
  telegramBotToken?: string;
  telegramChatId?: string;
  telegramBotUsername?: string;

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
  syncMode: 'full',
  syncProjects: true,
  syncTasks: true,
  syncSchedule: true,
  autoCreateThreads: true,
};

export const useMessengerStore = create<MessengerState>()(
  persist(
    (set, get) => ({
      connections: [],
      projectMappings: [],
      onboardingStep: null,
      onboardingType: null,

      addConnection: (type) => {
        const existing = get().connections.find(c => c.type === type);
        if (existing) return;
        set({ connections: [...get().connections, { ...DEFAULT_CONNECTION, type }] });
      },

      updateConnection: (type, updates) => {
        set({
          connections: get().connections.map(c =>
            c.type === type ? { ...c, ...updates } : c
          ),
        });
      },

      removeConnection: (type) => {
        set({
          connections: get().connections.filter(c => c.type !== type),
          projectMappings: get().projectMappings.map(m => {
            const next = { ...m };
            if (type === 'discord') delete next.discord;
            if (type === 'telegram') delete next.telegram;
            return next;
          }),
        });
      },

      testConnection: async (type) => {
        const conn = get().connections.find(c => c.type === type);
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
            const res = await fetch(`https://api.telegram.org/bot${conn.telegramBotToken}/getMe`);
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

      setProjectMapping: (mapping) => {
        set({
          projectMappings: [
            ...get().projectMappings.filter(m => m.projectId !== mapping.projectId),
            mapping,
          ],
        });
      },

      removeProjectMapping: (projectId) => {
        set({ projectMappings: get().projectMappings.filter(m => m.projectId !== projectId) });
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
        connections: state.connections.map(c => ({
          ...c,
          status: 'disconnected' as const,
          error: null,
        })),
        projectMappings: state.projectMappings,
      }),
    },
  ),
);
