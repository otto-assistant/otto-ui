import { loadDiscordRelayConfig } from './config.js';
import { runDiscordRelay } from './bot.js';

const cfg = loadDiscordRelayConfig();

await runDiscordRelay(cfg);
