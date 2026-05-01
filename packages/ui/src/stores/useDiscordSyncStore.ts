import { create } from 'zustand';

export interface DiscordAuthor {
  username: string;
  avatar: string | null;
}

export interface DiscordMessage {
  id: string;
  threadId: string;
  text: string;
  source: 'discord' | 'web';
  author: DiscordAuthor;
  createdAt: string;
}

export interface DiscordThread {
  id: string;
  name: string;
  channelId: string | null;
  createdAt: string;
}

interface DiscordSyncState {
  threads: DiscordThread[];
  messagesByThread: Record<string, DiscordMessage[]>;
  loading: boolean;

  fetchThreads: () => Promise<void>;
  fetchMessages: (threadId: string) => Promise<void>;
  sendMessage: (threadId: string, text: string) => Promise<void>;
  handleRealtimeMessage: (message: DiscordMessage) => void;
}

export const useDiscordSyncStore = create<DiscordSyncState>((set, get) => ({
  threads: [],
  messagesByThread: {},
  loading: false,

  fetchThreads: async () => {
    set({ loading: true });
    try {
      const res = await fetch('/api/otto/discord/threads');
      const data = await res.json();
      set({ threads: data.threads || [] });
    } finally {
      set({ loading: false });
    }
  },

  fetchMessages: async (threadId: string) => {
    set({ loading: true });
    try {
      const res = await fetch(`/api/otto/discord/threads/${threadId}/messages`);
      const data = await res.json();
      set((state) => ({
        messagesByThread: {
          ...state.messagesByThread,
          [threadId]: data.messages || [],
        },
      }));
    } finally {
      set({ loading: false });
    }
  },

  sendMessage: async (threadId: string, text: string) => {
    const res = await fetch('/api/otto/discord/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ threadId, text }),
    });
    const data = await res.json();
    if (data.message) {
      get().handleRealtimeMessage(data.message);
    }
  },

  handleRealtimeMessage: (message: DiscordMessage) => {
    set((state) => {
      const existing = state.messagesByThread[message.threadId] || [];
      // Deduplicate
      if (existing.some((m) => m.id === message.id)) return state;
      return {
        messagesByThread: {
          ...state.messagesByThread,
          [message.threadId]: [...existing, message],
        },
      };
    });
  },
}));
