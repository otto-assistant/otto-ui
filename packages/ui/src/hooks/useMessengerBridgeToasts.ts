import { useEffect } from 'react';
import { toast } from '@/components/ui/toast';
import {
  useOttoEventsStore,
  type OttoUiRealtimeEvent,
} from '@/stores/useOttoEventsStore';
import { useProjectsStore } from '@/stores/useProjectsStore';
import { useDirectoryStore } from '@/stores/useDirectoryStore';

/**
 * Surface incoming bridge events to the OpenChamber user via toasts so a
 * Discord/Telegram conversation that creates a new OpenCode session is
 * immediately discoverable from the web UI — including a one-click action
 * that switches to the project the bridge auto-resolved.
 *
 * Wired into App.tsx so it lives for the lifetime of the session.
 */
type SessionBoundPayload = {
  type?: 'discord' | 'telegram';
  channelId?: string;
  threadId?: string | null;
  sessionId?: string;
  projectPath?: string | null;
  projectLabel?: string | null;
  autoResolved?: 'slug-match' | 'fallback-first' | 'cached' | null;
  resolvedFromName?: string | null;
};

function projectsRecord(state: ReturnType<typeof useProjectsStore.getState>) {
  return state.projects;
}

function openProjectByPath(projectPath: string) {
  const state = useProjectsStore.getState();
  const list = projectsRecord(state);
  const match = list.find((p) => p.path === projectPath);
  if (!match) return false;
  state.setActiveProject(match.id);
  useDirectoryStore.getState().setDirectory(match.path, { showOverlay: false });
  return true;
}

export function useMessengerBridgeToasts() {
  const subscribeToEvents = useOttoEventsStore((s) => s.subscribeToEvents);

  useEffect(() => {
    const handler = (event: OttoUiRealtimeEvent) => {
      if (event.eventType === 'messenger.bridge.session_bound') {
        const data = event.data as SessionBoundPayload | undefined;
        if (!data || !data.sessionId) return;
        const projectName = data.projectLabel ?? data.projectPath ?? 'unknown project';
        const messengerName = data.type === 'telegram' ? 'Telegram' : 'Discord';
        const auto =
          data.autoResolved === 'slug-match'
            ? ` (auto-matched from "${data.resolvedFromName ?? ''}")`
            : data.autoResolved === 'fallback-first'
              ? ' (fallback to first project)'
              : '';
        toast.info(`${messengerName} → ${projectName}${auto}`, {
          description: `Session \`${data.sessionId.slice(0, 24)}\` is now bound to this conversation. Open it in OpenChamber to follow along.`,
          action: data.projectPath
            ? {
                label: 'Open project',
                onClick: () => {
                  if (!openProjectByPath(data.projectPath!)) {
                    toast.warning(`Project ${projectName} is not in your OpenChamber workspace yet.`);
                  }
                },
              }
            : undefined,
          duration: 12000,
        });
        return;
      }
      if (event.eventType === 'messenger.bridge.bootstrap_prompt') {
        const data = event.data as
          | { type?: 'discord' | 'telegram'; channelId?: string; originalText?: string }
          | undefined;
        if (!data) return;
        const messengerName = data.type === 'telegram' ? 'Telegram' : 'Discord';
        toast.info(`${messengerName} — new channel waiting for a project`, {
          description: `Reply in the channel with \`clone <git-url>\`, \`path </abs/path>\` or \`new <name>\` to set it up. Stashed message: "${(data.originalText ?? '').slice(0, 100)}"`,
          duration: 14000,
        });
        return;
      }
    };
    return subscribeToEvents(handler);
  }, [subscribeToEvents]);
}
