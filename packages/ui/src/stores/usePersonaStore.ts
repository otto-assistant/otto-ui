import { create } from 'zustand';
import { ottoFetch } from '../lib/api-base';
import { getSafeStorage } from './utils/safeStorage';

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
    tone: number;
  };
  language: string;
}

/** 'global' = use default persona settings; 'project' = use per-project overrides */
export type PersonaScope = 'global' | 'project';

interface PersonaState {
  agents: string[];
  selectedAgent: string | null;
  config: AgentConfig | null;
  isLoading: boolean;
  isSaving: boolean;
  error: string | null;
  _lastFetchedAt: number;

  /** ID of the currently-active project, mirrored from useProjectsStore */
  activeProjectId: string | null;
  /** Current scope: global default or per-project override */
  scope: PersonaScope;
  /** Per-project, per-agent overrides (in-memory mirror of localStorage) */
  projectOverrides: Record<string, Record<string, AgentConfig>>;
  /** Per-project scope choice (in-memory mirror of localStorage) */
  scopeByProject: Record<string, PersonaScope>;
  /** Global base configs (in-memory cache of last fetched/edited) */
  globalConfigs: Record<string, AgentConfig>;

  fetchAgents: () => Promise<void>;
  selectAgent: (name: string) => Promise<void>;
  updateConfig: (partial: Partial<AgentConfig>) => void;
  updateBehavior: (key: keyof AgentConfig['behavior'], value: number) => void;
  toggleSkill: (skillName: string) => void;
  saveAgent: () => Promise<void>;

  setActiveProjectId: (id: string | null) => void;
  setScope: (scope: PersonaScope) => void;
  setPersonaName: (name: string) => void;
}

const DEFAULT_SKILLS: AgentSkill[] = [
  { name: 'code_review', description: 'Review code changes', enabled: true },
  { name: 'testing', description: 'Write and run tests', enabled: true },
  { name: 'documentation', description: 'Generate documentation', enabled: false },
];

const DEFAULT_BEHAVIOR = { proactivity: 50, verbosity: 50, tone: 50 };

const MOCK_AGENTS = ['otto', 'coder', 'reviewer'];

const STORAGE_KEYS = {
  globalConfigs: 'otto.persona.globalConfigs',
  projectOverrides: 'otto.persona.projectOverrides',
  scopeByProject: 'otto.persona.scopeByProject',
} as const;

const safeStorage = getSafeStorage();

function readJSON<T>(key: string, fallback: T): T {
  try {
    const raw = safeStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function writeJSON(key: string, value: unknown): void {
  try {
    safeStorage.setItem(key, JSON.stringify(value));
  } catch {
    // ignore
  }
}

function defaultDisplayName(name: string): string {
  return name.charAt(0).toUpperCase() + name.slice(1);
}

function normalizeConfig(name: string, raw: Record<string, unknown>): AgentConfig {
  const description = (raw.description as string) ?? '';
  const runtimeData = (raw.runtime ?? raw) as Record<string, unknown>;
  const configData = (raw.config as Record<string, unknown>) ?? {};
  const innerConfig = (configData.config as Record<string, unknown>) ?? {};

  return {
    name: (runtimeData.name as string) ?? name,
    displayName: (raw.displayName as string) ?? defaultDisplayName(name),
    systemPrompt:
      (innerConfig.systemPrompt as string) ??
      (raw.systemPrompt as string) ??
      (description || 'You are a helpful AI assistant.'),
    skills: Array.isArray(raw.skills) ? raw.skills : DEFAULT_SKILLS,
    behavior: (raw.behavior as AgentConfig['behavior']) ?? DEFAULT_BEHAVIOR,
    language: (raw.language as string) ?? 'en',
  };
}

/** Deep clone a config so callers can't accidentally mutate cached state. */
function cloneConfig(config: AgentConfig): AgentConfig {
  return {
    ...config,
    behavior: { ...config.behavior },
    skills: config.skills.map((s) => ({ ...s })),
  };
}

/**
 * Compute the effective config for the active selection.
 *
 * Honors per-project overrides when the scope is set to 'project' and an
 * override has been recorded for `(projectId, agentName)`.
 */
function computeEffectiveConfig(
  agentName: string | null,
  scope: PersonaScope,
  projectId: string | null,
  globalConfigs: Record<string, AgentConfig>,
  projectOverrides: Record<string, Record<string, AgentConfig>>,
): AgentConfig | null {
  if (!agentName) return null;
  if (scope === 'project' && projectId) {
    const override = projectOverrides[projectId]?.[agentName];
    if (override) return cloneConfig(override);
  }
  const base = globalConfigs[agentName];
  return base ? cloneConfig(base) : null;
}

const initialGlobalConfigs = readJSON<Record<string, AgentConfig>>(STORAGE_KEYS.globalConfigs, {});
const initialProjectOverrides = readJSON<Record<string, Record<string, AgentConfig>>>(
  STORAGE_KEYS.projectOverrides,
  {},
);
const initialScopeByProject = readJSON<Record<string, PersonaScope>>(STORAGE_KEYS.scopeByProject, {});

export const usePersonaStore = create<PersonaState>((set, get) => ({
  agents: [],
  selectedAgent: null,
  config: null,
  isLoading: false,
  isSaving: false,
  error: null,
  _lastFetchedAt: 0,

  activeProjectId: null,
  scope: 'global',
  projectOverrides: initialProjectOverrides,
  scopeByProject: initialScopeByProject,
  globalConfigs: initialGlobalConfigs,

  fetchAgents: async () => {
    const STALE_MS = 30_000;
    const cur = get();
    if (
      cur.agents.length > 0 &&
      cur.config &&
      cur._lastFetchedAt &&
      Date.now() - cur._lastFetchedAt < STALE_MS
    ) {
      return;
    }
    set({ isLoading: true, error: null });
    try {
      const res = await ottoFetch('/api/otto/agents');
      if (!res.ok) throw new Error('Failed to fetch agents');
      const data = await res.json();
      const raw = data.agents ?? data;
      const agents = Array.isArray(raw)
        ? raw.map((a: unknown) =>
            typeof a === 'string' ? a : (a as { name?: string })?.name ?? String(a),
          )
        : [];
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
    const { globalConfigs, projectOverrides, scope, activeProjectId } = get();

    // If we already have a cached global config, switch instantly.
    if (globalConfigs[name]) {
      const effective = computeEffectiveConfig(
        name,
        scope,
        activeProjectId,
        globalConfigs,
        projectOverrides,
      );
      set({
        selectedAgent: name,
        config: effective,
        isLoading: false,
        error: null,
        _lastFetchedAt: Date.now(),
      });
      return;
    }

    set({ isLoading: true, selectedAgent: name, error: null });
    try {
      const res = await ottoFetch(`/api/otto/agents/${name}`);
      if (!res.ok) throw new Error('Failed to fetch agent config');
      const raw = await res.json();
      const fetched = normalizeConfig(name, raw);
      const nextGlobalConfigs = { ...get().globalConfigs, [name]: fetched };
      writeJSON(STORAGE_KEYS.globalConfigs, nextGlobalConfigs);
      const effective = computeEffectiveConfig(
        name,
        get().scope,
        get().activeProjectId,
        nextGlobalConfigs,
        get().projectOverrides,
      );
      set({
        globalConfigs: nextGlobalConfigs,
        config: effective,
        isLoading: false,
        _lastFetchedAt: Date.now(),
      });
    } catch {
      const fallback = normalizeConfig(name, {});
      const nextGlobalConfigs = { ...get().globalConfigs, [name]: fallback };
      writeJSON(STORAGE_KEYS.globalConfigs, nextGlobalConfigs);
      const effective = computeEffectiveConfig(
        name,
        get().scope,
        get().activeProjectId,
        nextGlobalConfigs,
        get().projectOverrides,
      );
      set({
        globalConfigs: nextGlobalConfigs,
        config: effective,
        isLoading: false,
        error: null,
        _lastFetchedAt: Date.now(),
      });
    }
  },

  updateConfig: (partial) => {
    const { config, scope, activeProjectId, selectedAgent } = get();
    if (!config || !selectedAgent) return;
    const next = { ...config, ...partial };
    set({ config: next });

    // Mirror change into the appropriate cache (in-memory + localStorage).
    if (scope === 'project' && activeProjectId) {
      const projectMap = { ...(get().projectOverrides[activeProjectId] ?? {}), [selectedAgent]: cloneConfig(next) };
      const projectOverrides = { ...get().projectOverrides, [activeProjectId]: projectMap };
      writeJSON(STORAGE_KEYS.projectOverrides, projectOverrides);
      set({ projectOverrides });
    } else {
      const globalConfigs = { ...get().globalConfigs, [selectedAgent]: cloneConfig(next) };
      writeJSON(STORAGE_KEYS.globalConfigs, globalConfigs);
      set({ globalConfigs });
    }
  },

  updateBehavior: (key, value) => {
    const { config } = get();
    if (!config) return;
    get().updateConfig({ behavior: { ...config.behavior, [key]: value } });
  },

  toggleSkill: (skillName) => {
    const { config } = get();
    if (!config) return;
    const skills = config.skills.map((s) =>
      s.name === skillName ? { ...s, enabled: !s.enabled } : s,
    );
    get().updateConfig({ skills });
  },

  setPersonaName: (name: string) => {
    get().updateConfig({ displayName: name });
  },

  saveAgent: async () => {
    const { config, selectedAgent, scope, activeProjectId } = get();
    if (!config || !selectedAgent) return;
    set({ isSaving: true, error: null });

    // For per-project scope, we only persist locally — there is no server-side
    // concept of "this agent for this project" yet.
    if (scope === 'project' && activeProjectId) {
      // updateConfig already persisted to localStorage; nothing else to do.
      set({ isSaving: false });
      return;
    }

    try {
      const res = await ottoFetch(`/api/otto/agents/${selectedAgent}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config),
      });
      if (!res.ok) throw new Error('Failed to save agent');
      set({ isSaving: false });
    } catch {
      // Settings stay in the local cache even on failure.
      set({ isSaving: false });
    }
  },

  setActiveProjectId: (id: string | null) => {
    const current = get().activeProjectId;
    if (current === id) return;
    const scopeForProject: PersonaScope = id ? get().scopeByProject[id] ?? 'global' : 'global';
    const effective = computeEffectiveConfig(
      get().selectedAgent,
      scopeForProject,
      id,
      get().globalConfigs,
      get().projectOverrides,
    );
    set({ activeProjectId: id, scope: scopeForProject, config: effective });
  },

  setScope: (scope: PersonaScope) => {
    const { activeProjectId, selectedAgent, globalConfigs, projectOverrides } = get();

    if (scope === 'project' && activeProjectId && selectedAgent) {
      // Seed the project override from the current global config if one
      // doesn't exist yet, so toggling the scope doesn't appear to wipe out
      // the prior values.
      if (!projectOverrides[activeProjectId]?.[selectedAgent]) {
        const seed = globalConfigs[selectedAgent];
        if (seed) {
          const projectMap = {
            ...(projectOverrides[activeProjectId] ?? {}),
            [selectedAgent]: cloneConfig(seed),
          };
          const nextOverrides = { ...projectOverrides, [activeProjectId]: projectMap };
          writeJSON(STORAGE_KEYS.projectOverrides, nextOverrides);
          set({ projectOverrides: nextOverrides });
        }
      }
    }

    if (activeProjectId) {
      const nextScopeByProject = { ...get().scopeByProject, [activeProjectId]: scope };
      writeJSON(STORAGE_KEYS.scopeByProject, nextScopeByProject);
      set({ scopeByProject: nextScopeByProject });
    }

    const effective = computeEffectiveConfig(
      get().selectedAgent,
      scope,
      get().activeProjectId,
      get().globalConfigs,
      get().projectOverrides,
    );
    set({ scope, config: effective });
  },
}));
