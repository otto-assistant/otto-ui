import { ChannelType, Client, Events, GatewayIntentBits } from 'discord.js';
import type { Message } from 'discord.js';

import { createAllowGate } from './allowlist.js';
import type { LoadedRelayConfig } from './config.js';
import { postPromptAsync } from './openchamber-client.js';

const relayTimeoutMs = (): number => {
  const raw = process.env.DISCORD_RELAY_HTTP_TIMEOUT_MS;
  const n = typeof raw === 'string' ? Number.parseInt(raw, 10) : Number.NaN;
  return Number.isFinite(n) && n > 0 ? n : 60_000;
};

const formatInboundText = (message: Message): string => {
  const authorTag = `${message.author.tag} (${message.author.id})`;

  const contentRaw = typeof message.content === 'string' ? message.content.trim() : '';
  const stickerLines =
    message.stickers?.map((sticker) => `[sticker:${sticker.name}:${sticker.id}]`).join('\n') ?? '';

  const contentParts = [];
  if (contentRaw.length > 0) {
    contentParts.push(contentRaw);
  }
  if (stickerLines.length > 0) {
    contentParts.push(stickerLines);
  }
  const mergedContent = contentParts.join('\n');
  const body =
    mergedContent.length > 0
      ? mergedContent
      : '[empty Discord message body - attachments/binary payloads are intentionally not relayed]';

  const isDmLike = message.guild === null;

  if (isDmLike) {
    return `Discord DM/group DM from ${authorTag}:\n${body}`;
  }

  const guild = message.guild;
  let channelLabel = `channel:${message.channelId}`;
  if (
    message.channel.isTextBased() &&
    message.channel.type !== ChannelType.PublicThread &&
    message.channel.type !== ChannelType.PrivateThread &&
    'name' in message.channel &&
    typeof message.channel.name === 'string'
  ) {
    channelLabel = `#${message.channel.name}`;
  } else if (
    message.channel.type === ChannelType.PublicThread ||
    message.channel.type === ChannelType.PrivateThread
  ) {
    channelLabel = `thread:${message.channel.name ?? message.channelId}`;
  }

  const guildLabel = guild ? `${guild.name} (${guild.id})` : `unknown-guild (${message.guildId ?? 'n/a'})`;

  return `[Discord guild=${guildLabel} ${channelLabel}] ${authorTag}:\n${body}`;
};

export async function runDiscordRelay(config: LoadedRelayConfig): Promise<void> {
  const allowGate = createAllowGate(config.allowlists);

  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,

      GatewayIntentBits.DirectMessages,
    ],
  });

  client.once(Events.ClientReady, (readyClient) => {
    console.log(`discord-relay: logged in as ${readyClient.user.tag}`);
    console.log(`discord-relay: openchamber=${config.openchamberBaseUrl} session=${config.sessionId}`);
    const chanLog =
      config.allowlists.channelIds && config.allowlists.channelIds.size > 0
        ? `${config.allowlists.channelIds.size} guild channels allowlisted`
        : 'any guild channel allowed (users remain gated)';
    console.log(`discord-relay: ${config.allowlists.userIds.size} users allowlisted; ${chanLog}`);
  });

  client.on(Events.MessageCreate, (incoming) => {
    // Lowest-level synchronous allowlist gate: no awaits permitted before these checks finish.
    if (incoming.author.bot) {
      return;
    }

    const isDmLike = incoming.guild === null;
    const channelIdForGate = isDmLike ? null : incoming.channelId;

    if (
      !allowGate.ok({
        userId: incoming.author.id,
        channelId: channelIdForGate,
        isDm: isDmLike,
      })
    ) {
      return;
    }

    void relayMessageSafe(incoming).catch((error) =>
      console.error('discord-relay: relay worker failed:', error?.message ?? error),
    );
  });

  await client.login(config.discordBotToken);

  async function relayMessageSafe(message: Message) {
    const text = formatInboundText(message);
    const controller = new AbortController();
    const timer = globalThis.setTimeout(() => controller.abort(), relayTimeoutMs());

    const clientConfig = {
      baseUrl: config.openchamberBaseUrl,
      sessionId: config.sessionId,
      authorization: config.authorization,
      ...(typeof config.workspaceDirectory === 'string'
        ? { workspaceDirectory: config.workspaceDirectory }
        : {}),
    };

    try {
      const result = await postPromptAsync(clientConfig, text, controller.signal);

      if (!result.ok) {
        console.error(
          `discord-relay: upstream error ${result.status} for message ${message.id}: ${result.body}`,
        );
        return;
      }

      console.log(
        `discord-relay: relayed message=${message.id} author=${message.author.id} upstream=${result.status}`,
      );
    } finally {
      globalThis.clearTimeout(timer);
    }
  }

  let shuttingDown = false;
  const shutdown = async (signal: NodeJS.Signals) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`discord-relay: received ${signal}; shutting down`);
    client.removeAllListeners();
    await client.destroy();
    process.exit(0);
  };

  process.once('SIGINT', () => {
    void shutdown('SIGINT');
  });
  process.once('SIGTERM', () => {
    void shutdown('SIGTERM');
  });
}
