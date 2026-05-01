# Wave 2 Agent 2: Memory Browser

**Goal:** Knowledge graph visualization, list, diary, and search at `packages/ui/src/components/views/memory/`

**Study:** `packages/ui/src/components/views/MemoryView.tsx` (placeholder), theme system

**Build:**

1. **MemoryView.tsx** — tabs: Graph | List | Diary | Search
2. **GraphView.tsx** — simple canvas/SVG force-directed graph (no heavy deps, use basic SVG circles+lines or a lightweight lib). Nodes=entities (colored by type), edges=relations. Click node shows details.
3. **ListView.tsx** — table: Entity, Predicate, Object, Valid From/To. Sortable columns. Filter inputs. Add row button. Delete with confirm.
4. **DiaryView.tsx** — chronological entries list. Date headers. Topic filter. Each entry shows timestamp + decoded content.
5. **SearchView.tsx** — input with debounce 300ms. Results list with relevance badge. Click → show details.
6. **MemoryStore** — `packages/ui/src/stores/useMemoryStore.ts`: entities, relations, diary, searchResults, activeTab, fetch methods

**API:** GET `/api/otto/memory/graph`, `/api/otto/memory/diary`, `/api/otto/memory/search?q=`

**Rules:** Theme tokens. If graph library too complex, use simple table-based entity browser. No react-force-graph (too heavy). Keep it lightweight. Commit.
