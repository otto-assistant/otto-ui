import type { IconName } from '@/components/icon/icons';
import type { SettingsPageSlug } from '@/lib/settings/metadata';

/**
 * Icon mapping for settings navigation entries.
 *
 * Lives in its own module (not SettingsView.tsx) so light-weight consumers
 * like the command palette can read icons without statically importing the
 * entire settings view graph — that import defeated SettingsView's lazy
 * split and dragged hundreds of modules into the app's critical path.
 */
export function getSettingsNavIcon(slug: SettingsPageSlug): IconName | null {
  switch (slug) {
    case 'projects':
      return 'folders';
    case 'remote-instances':
      return 'server';
    case 'appearance':
      return 'palette';
    case 'chat':
      return 'chat-ai-3';
    case 'magic-prompts':
      return 'ai-generate-2';
    case 'snippets':
      return 'chat-thread';
    case 'notifications':
      return 'notification-3';
    case 'shortcuts':
      return 'command';
    case 'sessions':
      return 'chat-history';

    case 'providers':
      return 'cloud';
    case 'agents':
      return 'ai-agent';
    case 'behavior':
      return 'brain';
    case 'commands':
      return 'slash-commands-2';
    case 'mcp':
      // Rendered as the custom McpIcon component by consumers (no sprite icon).
      return null;
    case 'plugins':
      return 'code-box';

    case 'skills.installed':
      return 'book-open';
    case 'skills.catalog':
      return 'book';

    case 'memory':
      return 'brain';
    case 'memory.opencode-mem':
      return 'database-2';
    case 'memory.mempalace':
      return 'node-tree';
    case 'memory.codemem':
      return 'archive';
    case 'memory.hindsight':
      return 'sparkling';

    case 'git':
      return 'git-branch';

    case 'integrations':
      return 'external-link';

    case 'usage':
      return 'bar-chart-2';
    case 'voice':
      return 'mic';
    case 'tunnel':
      return 'global';
    case 'about':
      return 'information';
    case 'home':
      return null;
    default:
      return 'robot-2';
  }
}
