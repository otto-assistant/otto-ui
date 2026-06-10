import crypto from 'node:crypto';
import {
  WIZARD_TTL_MS,
  PAGE_SIZE,
  PREV_VALUE,
  NEXT_VALUE,
  buildPagedOptions,
  stringSelect,
  botHashFor,
  createWizardStore,
} from './discord-wizard-shared.js';

/**
 * Interactive `/model` wizard for the Discord gateway listener.
 *
 * Discord string-select menus are capped at 25 options, so a provider with
 * dozens of models (or an account connected to many providers) overflowed the
 * old single-page menu and silently dropped everything past the 25th entry.
 * The shared paging helpers render the provider / model lists as PAGED select
 * menus: each page shows up to {@link PAGE_SIZE} real choices plus
 * `◀ Previous` / `More ▶` navigation entries when there is more to show.
 *
 * Flow: `/model` → pick provider → pick model → pick scope (channel / global).
 * Wizard state is keyed by a short random hash embedded in each select's
 * `custom_id` and expires after {@link WIZARD_TTL_MS}.
 *
 * Kept free of gateway/WebSocket plumbing so it can be unit-tested in
 * isolation; the listener just delegates the matching interactions here.
 */

// Re-exported for callers/tests that import the paging helpers from here.
export { WIZARD_TTL_MS, PAGE_SIZE, buildPagedOptions };

const PROVIDER_PREFIX = 'otto-model-provider:';
const MODEL_PREFIX = 'otto-model-model:';
const SCOPE_PREFIX = 'otto-model-scope:';

/** Normalise a provider's `models` (array or map) into a flat array. */
export function modelsOf(provider) {
  if (!provider || !provider.models) return [];
  return Array.isArray(provider.models) ? provider.models : Object.values(provider.models);
}

export function createDiscordModelWizard({ restCall, bridge }) {
  const wizards = createWizardStore();
  const setWizard = wizards.set;
  const getWizard = wizards.get;
  const delWizard = wizards.del;

  /** Send an interaction callback using the bot token. */
  function respond(token, interaction, data) {
    return restCall(
      token,
      'POST',
      `/interactions/${interaction.id}/${interaction.token}/callback`,
      data,
    );
  }

  function expired(token, interaction) {
    return respond(token, interaction, {
      type: 7,
      data: { content: 'Selection expired. Please run /model again.', flags: 64, components: [] },
    });
  }

  /** Is this a component interaction this wizard owns? */
  function ownsComponent(customId) {
    return (
      typeof customId === 'string' &&
      (customId.startsWith(PROVIDER_PREFIX) ||
        customId.startsWith(MODEL_PREFIX) ||
        customId.startsWith(SCOPE_PREFIX))
    );
  }

  // ── rendering ─────────────────────────────────────────────────────────────
  function providerOptions(providers) {
    return providers.map((p) => {
      const count = modelsOf(p).length;
      return {
        label: (p.name ?? p.id).slice(0, 100),
        value: p.id,
        description: `${count} model${count === 1 ? '' : 's'}`.slice(0, 100),
      };
    });
  }

  function renderProviderSelect(hash, providers, page) {
    const { options } = buildPagedOptions(providerOptions(providers), page);
    return stringSelect(`${PROVIDER_PREFIX}${hash}`, options, 'Select a provider');
  }

  function modelOptions(models) {
    return models.map((m) => ({
      label: (m.name ?? m.id ?? String(m)).slice(0, 100),
      value: m.id ?? m.name ?? String(m),
      description: (m.release_date ? new Date(m.release_date).toLocaleDateString() : ' ').slice(0, 100),
    }));
  }

  function renderModelSelect(hash, models, page) {
    const { options } = buildPagedOptions(modelOptions(models), page);
    return stringSelect(`${MODEL_PREFIX}${hash}`, options, 'Select a model');
  }

  // ── /model command entrypoint ──────────────────────────────────────────────
  async function start(state, interaction) {
    const hash = crypto.randomBytes(6).toString('hex');

    let providerData;
    try {
      providerData = await bridge?.fetchProviders?.();
    } catch {
      providerData = null;
    }

    if (!providerData || !Array.isArray(providerData.all) || providerData.all.length === 0) {
      // No structured provider data — fall back to the text `/model` command.
      const result = await bridge?.runCommand?.({
        type: 'discord',
        token: state.token,
        channelId: interaction.channel_id,
        commandName: 'model',
      });
      await respond(state.token, interaction, {
        type: 4,
        data: { content: result?.reply?.slice(0, 2000) ?? '_(no providers configured)_', flags: 64 },
      });
      return;
    }

    const connectedSet = new Set(Array.isArray(providerData.connected) ? providerData.connected : []);
    // Prefer providers with credentials, but never render an empty menu: if
    // nothing is flagged connected, show everything OpenCode knows about.
    const connected = providerData.all.filter((p) => connectedSet.has(p.id));
    const available = connected.length > 0 ? connected : providerData.all;

    setWizard(hash, {
      token: state.token,
      channelId: interaction.channel_id,
      guildId: interaction.guild_id,
      appId: interaction.application_id,
      providers: available,
      providerPage: 0,
      modelPage: 0,
    });

    await respond(state.token, interaction, {
      type: 4,
      data: {
        content: '**Set Model Preference**\nSelect a provider:',
        flags: 64,
        components: [renderProviderSelect(hash, available, 0)],
      },
    });
  }

  // ── component (select-menu) interactions ───────────────────────────────────
  async function handleComponent(state, interaction, customId) {
    const token = state?.token;
    if (customId.startsWith(PROVIDER_PREFIX)) {
      return onProviderSelect(token, interaction, customId.slice(PROVIDER_PREFIX.length));
    }
    if (customId.startsWith(MODEL_PREFIX)) {
      return onModelSelect(token, interaction, customId.slice(MODEL_PREFIX.length));
    }
    if (customId.startsWith(SCOPE_PREFIX)) {
      return onScopeSelect(token, interaction, customId.slice(SCOPE_PREFIX.length));
    }
  }

  async function onProviderSelect(token, interaction, hash) {
    const wizard = getWizard(hash);
    if (!wizard) return expired(token, interaction);
    const value = interaction.data?.values?.[0];
    if (!value) return;

    if (value === PREV_VALUE || value === NEXT_VALUE) {
      wizard.providerPage = (wizard.providerPage ?? 0) + (value === NEXT_VALUE ? 1 : -1);
      setWizard(hash, wizard);
      await respond(wizard.token, interaction, {
        type: 7,
        data: {
          content: '**Set Model Preference**\nSelect a provider:',
          flags: 64,
          components: [renderProviderSelect(hash, wizard.providers, wizard.providerPage)],
        },
      });
      return;
    }

    const provider = wizard.providers.find((p) => p.id === value);
    if (!provider) return;
    const models = modelsOf(provider);

    if (models.length === 0) {
      await respond(wizard.token, interaction, {
        type: 7,
        data: {
          content: `Provider **${provider.name ?? provider.id}** has no models available.`,
          flags: 64,
          components: [],
        },
      });
      return;
    }

    wizard.providerId = provider.id;
    wizard.providerName = provider.name ?? provider.id;
    wizard.models = models;
    wizard.modelPage = 0;
    setWizard(hash, wizard);

    await respond(wizard.token, interaction, {
      type: 7,
      data: {
        content: `**Set Model Preference**\nProvider: **${wizard.providerName}**\nSelect a model:`,
        flags: 64,
        components: [renderModelSelect(hash, models, 0)],
      },
    });
  }

  async function onModelSelect(token, interaction, hash) {
    const wizard = getWizard(hash);
    if (!wizard) return expired(token, interaction);
    const value = interaction.data?.values?.[0];
    if (!value) return;

    if (value === PREV_VALUE || value === NEXT_VALUE) {
      wizard.modelPage = (wizard.modelPage ?? 0) + (value === NEXT_VALUE ? 1 : -1);
      setWizard(hash, wizard);
      await respond(wizard.token, interaction, {
        type: 7,
        data: {
          content: `**Set Model Preference**\nProvider: **${wizard.providerName}**\nSelect a model:`,
          flags: 64,
          components: [renderModelSelect(hash, wizard.models, wizard.modelPage)],
        },
      });
      return;
    }

    wizard.selectedModelId = `${wizard.providerId}/${value}`;
    wizard.selectedModelLocal = value;
    setWizard(hash, wizard);

    const scopeOptions = [
      { label: 'This channel only', value: 'channel', description: 'Override for this channel only' },
      { label: 'Project default', value: 'global', description: 'Default for this project / channel' },
    ];

    await respond(wizard.token, interaction, {
      type: 7,
      data: {
        content: `**Set Model Preference**\nModel: **${wizard.providerName}** / **${value}**\n\`${wizard.selectedModelId}\`\nApply to:`,
        flags: 64,
        components: [stringSelect(`${SCOPE_PREFIX}${hash}`, scopeOptions, 'Apply to…')],
      },
    });
  }

  async function onScopeSelect(token, interaction, hash) {
    const wizard = getWizard(hash);
    if (!wizard) return expired(token, interaction);
    const scope = interaction.data?.values?.[0];
    if (!scope) return;

    const modelId = wizard.selectedModelId;
    const modelDisplay = wizard.selectedModelLocal ?? modelId;
    let scopeLabel = 'this channel';

    if (bridge?.store) {
      try {
        const botTokenHash = botHashFor(wizard.token);
        const targetKey = String(wizard.channelId);
        // "Project default" applies to every surface that lands in the channel's
        // project. We can only do that when the channel already resolves to a
        // project; otherwise fall back to a channel-scoped override so the
        // choice still takes effect immediately.
        const binding =
          scope === 'global'
            ? bridge.store.lookup?.({ type: 'discord', botTokenHash, targetKey })
            : null;
        if (scope === 'global' && binding?.projectPath) {
          bridge.store.setProjectDefaults?.({
            projectPath: binding.projectPath,
            projectLabel: binding.projectLabel,
            modelDefault: modelId,
          });
          scopeLabel = `project *${binding.projectLabel ?? binding.projectPath}*`;
        } else {
          bridge.store.setOverrides({
            type: 'discord',
            botTokenHash,
            targetKey,
            modelOverride: modelId,
          });
          scopeLabel = scope === 'global' ? 'this channel (no project bound yet)' : 'this channel';
        }
      } catch {
        // best effort — the reply still reflects the user's choice
      }
    }

    delWizard(hash);

    await respond(wizard.token, interaction, {
      type: 7,
      data: {
        content: `✓ Model for ${scopeLabel}:\n**${wizard.providerName}** / **${modelDisplay}**\n\`${modelId}\``,
        flags: 64,
        components: [],
      },
    });
  }

  return { start, handleComponent, ownsComponent };
}
