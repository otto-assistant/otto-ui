import { create } from 'zustand';
import { ottoFetch } from '../lib/api-base';

export interface AgentSkill {
  name: string;
  description: string;
  enabled: boolean;
}

export interface AgentConfig {
  name: string;
  displayName: string;
  systemPrompt: string;
  skills: AgentSkill[];
  behavior: {
    proactivity: number;
    verbosity: number;
    tone: number; // 0 = formal, 100 = casual
  };
  language: string;
}

interface PersonaState {
  agents: string[];
  selectedAgent: string | null;
  config: AgentConfig | null;
  isLoading: boolean;
  isSaving: boolean;
  error: string | null;
  fetchAgents: () => Promise<void>;
  selectAgent: (name: string) => Promise<void>;
  updateConfig: (partial: Partial<AgentConfig>) => void;
  updateBehavior: (key: keyof AgentConfig['behavior'], value: number) => void;
  toggleSkill: (skillName: string) => void;
  saveAgent: () => Promise<void>;
}

const MOCK_AGENTS = ['otto', 'coder', 'reviewer'];

function buildMockConfig(name: string): AgentConfig {
  return {
    name,
    displayName: name.charAt(0).toUpperCase() + name.slice(1),
    systemPrompt: 'You are a helpful AI assistant.',
    skills: [
      { name: 'code_review', description: 'Review code changes', enabled: true },
      { name: 'testing', description: 'Write and run tests', enabled: true },
      { name: 'documentation', description: 'Generate documentation', enabled: false },
    ],
    behavior: { proactivity: 50, verbosity: 50, tone: 50 },
    language: 'en',
  };
}

export const usePersonaStore = create<PersonaState>((set, get) => ({
  agents: [],
  selectedAgent: null,
  config: null,
  isLoading: false,
  isSaving: false,
  error: null,

  fetchAgents: async () => {
    set({ isLoading: true, error: null });
    try {
      const res = await ottoFetch('/api/otto/agents');
      if (!res.ok) throw new Error('Failed to fetch agents');
      const data = await res.json();
      const raw = data.agents ?? data;
      const agents = Array.isArray(raw) ? raw.map((a: unknown) => typeof a === 'string' ? a : (a as { name?: string })?.name ?? String(a)) : [];
      const effectiveAgents = agents.length > 0 ? agents : MOCK_AGENTS;
      set({ agents: effectiveAgents, isLoading: false });
      if (!get().selectedAgent) {
        await get().selectAgent(effectiveAgents[0]);
      }
    } catch {
      set({ agents: MOCK_AGENTS, isLoading: false, error: null });
      if (!get().selectedAgent) {
        await get().selectAgent(MOCK_AGENTS[0]);
      }
    }
  },

  selectAgent: async (name: string) => {
    set({ isLoading: true, selectedAgent: name, error: null });
    try {
      const res = await ottoFetch(`/api/otto/agents/${name}`);
      if (!res.ok) throw new Error('Failed to fetch agent config');
      const config: AgentConfig = await res.json();
      set({ config, isLoading: false });
    } catch {
      set({ config: buildMockConfig(name), isLoading: false, error: null });
    }
  },

  updateConfig: (partial) => {
    const { config } = get();
    if (config) set({ config: { ...config, ...partial } });
  },

  updateBehavior: (key, value) => {
    const { config } = get();
    if (config) {
      set({ config: { ...config, behavior: { ...config.behavior, [key]: value } } });
    }
  },

  toggleSkill: (skillName) => {
    const { config } = get();
    if (config) {
      const skills = config.skills.map((s) =>
        s.name === skillName ? { ...s, enabled: !s.enabled } : s
      );
      set({ config: { ...config, skills } });
    }
  },

  saveAgent: async () => {
    const { config, selectedAgent } = get();
    if (!config || !selectedAgent) return;
    set({ isSaving: true, error: null });
    try {
      const res = await ottoFetch(`/api/otto/agents/${selectedAgent}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config),
      });
      if (!res.ok) throw new Error('Failed to save agent');
      set({ isSaving: false });
    } catch (e) {
      set({ error: (e as Error).message, isSaving: false });
    }
  },
}));
