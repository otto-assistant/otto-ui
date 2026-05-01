import { create } from "zustand";

export type MemoryTab = "graph" | "list" | "diary" | "search";

export interface Entity {
  id: string;
  name: string;
  type: string; // person, project, concept, place
}

export interface Relation {
  id: string;
  subject: string;
  predicate: string;
  object: string;
  validFrom?: string;
  validTo?: string;
}

export interface DiaryEntry {
  id: string;
  date: string;
  topic: string;
  content: string;
  agent: string;
}

export interface SearchResult {
  id: string;
  content: string;
  relevance: number;
  wing: string;
  room: string;
}

// Mock data for development
const MOCK_ENTITIES: Entity[] = [
  { id: "e1", name: "Otto", type: "agent" },
  { id: "e2", name: "Alice", type: "person" },
  { id: "e3", name: "otto-ui", type: "project" },
  { id: "e4", name: "TypeScript", type: "concept" },
  { id: "e5", name: "Memory Palace", type: "concept" },
  { id: "e6", name: "Max", type: "person" },
];

const MOCK_RELATIONS: Relation[] = [
  { id: "r1", subject: "Otto", predicate: "works_on", object: "otto-ui", validFrom: "2026-04-01" },
  { id: "r2", subject: "Alice", predicate: "owns", object: "otto-ui", validFrom: "2026-03-01" },
  { id: "r3", subject: "otto-ui", predicate: "uses", object: "TypeScript", validFrom: "2026-03-01" },
  { id: "r4", subject: "Otto", predicate: "maintains", object: "Memory Palace", validFrom: "2026-04-15" },
  { id: "r5", subject: "Max", predicate: "child_of", object: "Alice", validFrom: "2015-01-01" },
  { id: "r6", subject: "Max", predicate: "loves", object: "TypeScript", validFrom: "2025-09-01" },
];

const MOCK_DIARY: DiaryEntry[] = [
  { id: "d1", date: "2026-05-01", topic: "general", content: "SESSION:2026-05-01|built.memory.browser|graph+list+diary+search", agent: "otto" },
  { id: "d2", date: "2026-04-30", topic: "coding", content: "SESSION:2026-04-30|wave2.impl.started|4.agents.dispatched", agent: "otto" },
  { id: "d3", date: "2026-04-29", topic: "general", content: "SESSION:2026-04-29|palace.tunnels.working|kg.queries.fast", agent: "otto" },
];

const MOCK_SEARCH_RESULTS: SearchResult[] = [
  { id: "s1", content: "Otto works on otto-ui project since April 2026", relevance: 0.95, wing: "wing_code", room: "otto-ui" },
  { id: "s2", content: "Memory Palace maintains knowledge graph with entities and relations", relevance: 0.87, wing: "wing_otto", room: "architecture" },
];

interface MemoryState {
  activeTab: MemoryTab;
  entities: Entity[];
  relations: Relation[];
  diary: DiaryEntry[];
  searchResults: SearchResult[];
  searchQuery: string;
  selectedEntity: Entity | null;
  loading: boolean;

  setActiveTab: (tab: MemoryTab) => void;
  setSelectedEntity: (entity: Entity | null) => void;
  fetchGraph: () => Promise<void>;
  fetchDiary: () => Promise<void>;
  searchMemory: (query: string) => Promise<void>;
  addRelation: (relation: Omit<Relation, "id">) => void;
  deleteRelation: (id: string) => void;
}

export const useMemoryStore = create<MemoryState>((set, get) => ({
  activeTab: "graph",
  entities: MOCK_ENTITIES,
  relations: MOCK_RELATIONS,
  diary: MOCK_DIARY,
  searchResults: [],
  searchQuery: "",
  selectedEntity: null,
  loading: false,

  setActiveTab: (tab) => set({ activeTab: tab }),
  setSelectedEntity: (entity) => set({ selectedEntity: entity }),

  fetchGraph: async () => {
    set({ loading: true });
    try {
      const res = await fetch("/api/otto/memory/graph");
      if (res.ok) {
        const data = await res.json();
        set({ entities: data.entities ?? MOCK_ENTITIES, relations: data.relations ?? MOCK_RELATIONS });
      }
    } catch {
      // Use mock data on failure
      set({ entities: MOCK_ENTITIES, relations: MOCK_RELATIONS });
    } finally {
      set({ loading: false });
    }
  },

  fetchDiary: async () => {
    set({ loading: true });
    try {
      const res = await fetch("/api/otto/memory/diary");
      if (res.ok) {
        const data = await res.json();
        set({ diary: data.entries ?? MOCK_DIARY });
      }
    } catch {
      set({ diary: MOCK_DIARY });
    } finally {
      set({ loading: false });
    }
  },

  searchMemory: async (query: string) => {
    set({ searchQuery: query, loading: true });
    if (!query.trim()) {
      set({ searchResults: [], loading: false });
      return;
    }
    try {
      const res = await fetch(`/api/otto/memory/search?q=${encodeURIComponent(query)}`);
      if (res.ok) {
        const data = await res.json();
        set({ searchResults: data.results ?? MOCK_SEARCH_RESULTS });
      }
    } catch {
      set({ searchResults: MOCK_SEARCH_RESULTS });
    } finally {
      set({ loading: false });
    }
  },

  addRelation: (relation) => {
    const id = `r${Date.now()}`;
    set((s) => ({ relations: [...s.relations, { ...relation, id }] }));
  },

  deleteRelation: (id) => {
    set((s) => ({ relations: s.relations.filter((r) => r.id !== id) }));
  },
}));
