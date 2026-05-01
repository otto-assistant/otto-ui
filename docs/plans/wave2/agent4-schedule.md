# Wave 2 Agent 4: Schedule/Calendar View

**Goal:** Calendar view for scheduled tasks at `packages/ui/src/components/views/schedule/`

**Study:** `packages/ui/src/components/views/ScheduleView.tsx` (placeholder)

**Build:**

1. **ScheduleView.tsx** — month/week toggle + create button + calendar grid
2. **CalendarMonth.tsx** — 7-col grid, day numbers, event dots on days with items. Highlight today. Nav arrows.
3. **CalendarWeek.tsx** — 7 columns, each showing day's events as stacked cards
4. **ScheduleEventCard.tsx** — title, time, type icon (one-time=circle, recurring=refresh), status color
5. **CreateScheduleDialog.tsx** — modal: prompt/title, type toggle (one-time|recurring), datetime picker for one-time, cron input for recurring, agent selector
6. **CronHumanizer.tsx** — small component that takes cron string and shows human text (e.g. "Every Monday at 9am"). Implement with simple parsing (match common patterns), no external dep.
7. **ScheduleStore** — `packages/ui/src/stores/useScheduleStore.ts`: events[], viewMode (month|week), currentDate, createEvent(), deleteEvent(), fetchSchedule()

**API:** GET/POST/DELETE `/api/otto/schedule`

**Rules:** Theme tokens. Simple CSS grid for calendar. Responsive (list view on mobile). Commit.
