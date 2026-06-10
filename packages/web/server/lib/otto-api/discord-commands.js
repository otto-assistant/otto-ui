/**
 * Native Discord application (slash) command registration for the Otto bot.
 *
 * Without registering these, typing `/model` in Discord just sends literal text
 * and the interactive wizards (which fire on APPLICATION_COMMAND interactions)
 * never run. We register the full set against the bot's application on every
 * gateway READY so a fresh bot — or a bot that gained a new command after an
 * update — works out of the box with autocomplete suggestions and dropdowns.
 *
 * Registration is guild-scoped when a guildId is known (instant propagation),
 * otherwise global (can take up to an hour to appear). Both are idempotent:
 * Discord upserts by name, so re-registering on each connect is safe.
 */

const STRING_OPTION = 3;

/**
 * The canonical Otto slash command set. Descriptions are kept ≤ 100 chars
 * (Discord's hard limit). Commands backed by an interactive wizard
 * (`model`, `agent`, `verbosity`, `skill`) take no options — the dropdowns
 * collect everything. The rest map straight onto the text command pipeline.
 */
export function buildSlashCommandDefinitions() {
  return [
    { name: 'help', description: 'List Otto messenger commands' },
    { name: 'status', description: 'Show the session, project, model and agent for this conversation' },
    { name: 'abort', description: 'Stop the current OpenCode turn' },
    { name: 'new', description: 'Drop the current session and start fresh on the next message' },
    { name: 'undo', description: 'Revert one user message' },
    { name: 'redo', description: 'Step forward through undo' },
    { name: 'compact', description: 'Summarise + compact the session history (destructive)' },
    {
      name: 'summary',
      description: 'Write a non-destructive summary of the session',
      options: [
        { type: STRING_OPTION, name: 'topic', description: 'Optional topic to focus the summary on', required: false },
      ],
    },
    { name: 'init', description: 'Run OpenCode init (creates/updates AGENTS.md)' },
    { name: 'review', description: 'Run the OpenCode review workflow' },
    { name: 'model', description: 'Pick the model for this conversation (or set a project default)' },
    { name: 'agent', description: 'Pick the agent for this conversation (or set a project default)' },
    { name: 'verbosity', description: 'Choose how much Otto streams back (this chat or everywhere)' },
    { name: 'skill', description: 'Pick an available skill and hand it to the agent' },
    { name: 'sessions', description: 'List recent OpenCode sessions for this project' },
  ].map((c) => ({ type: 1, ...c }));
}

/**
 * Register the Otto slash commands against a bot application.
 *
 * @param {object} args
 * @param {(token, method, path, body) => Promise<{ok:boolean,status:number,body:any}>} args.restCall
 * @param {string} args.token        bot token
 * @param {string} args.applicationId  bot application id (equals the bot user id)
 * @param {string|null} [args.guildId]  register guild-scoped when set (instant)
 * @returns {Promise<{ ok: boolean, scope: 'guild'|'global', status?: number, error?: string }>}
 */
export async function registerApplicationCommands({ restCall, token, applicationId, guildId = null }) {
  if (!applicationId) return { ok: false, scope: 'global', error: 'no application id' };
  const commands = buildSlashCommandDefinitions();
  const scope = guildId ? 'guild' : 'global';
  const path = guildId
    ? `/applications/${encodeURIComponent(applicationId)}/guilds/${encodeURIComponent(guildId)}/commands`
    : `/applications/${encodeURIComponent(applicationId)}/commands`;
  try {
    const r = await restCall(token, 'PUT', path, commands);
    if (!r.ok) {
      return {
        ok: false,
        scope,
        status: r.status,
        error: typeof r.body === 'string' ? r.body.slice(0, 300) : `HTTP ${r.status}`,
      };
    }
    return { ok: true, scope, status: r.status };
  } catch (err) {
    return { ok: false, scope, error: err?.message ?? 'registration failed' };
  }
}
