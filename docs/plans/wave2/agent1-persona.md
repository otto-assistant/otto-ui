# Wave 2 Agent 1: Persona Editor

**Goal:** Full agent persona management UI at `packages/ui/src/components/views/persona/`

**Study:** `packages/ui/src/components/views/PersonaView.tsx` (placeholder), `packages/ui/src/components/views/SettingsView.tsx` (patterns), theme system in `packages/ui/src/lib/theme/`

**Build:**

1. **PersonaView.tsx** — container with agent selector tabs at top
2. **AgentSelector.tsx** — horizontal tabs/dropdown showing available agents
3. **SystemPromptEditor.tsx** — large textarea with markdown, char count, save button
4. **SkillsToggles.tsx** — grid of cards, each with name + description + toggle switch
5. **BehaviorSliders.tsx** — labeled range inputs: Proactivity (0-100), Verbosity (0-100), Tone (formal↔casual)
6. **LanguageSelector.tsx** — select dropdown for agent language
7. **PersonaStore** — `packages/ui/src/stores/usePersonaStore.ts`: agents list, selectedAgent, config, save(), isLoading

**API:** GET `/api/otto/agents` for list, GET `/api/otto/agents/:name` for details, PUT `/api/otto/agents/:name` to save.

**Rules:** Theme tokens only. Responsive. Save shows toast. Run `bun run type-check`. Commit.
