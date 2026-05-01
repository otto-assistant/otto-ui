import type { GlobalEvent, OpencodeClient } from "@opencode-ai/sdk";
import type { REST } from "@discordjs/rest";

import { DiscordEditPump } from "./discord-edit-pump";

import { SessionStreamManager, type SessionStreamHooks } from "./session-stream-manager";

import { runOpencodeGlobalEventSubscriber } from "./sse-subscriber";

export type DiscordStreamingBridgeOptions = Readonly<{
  opencode: OpencodeClient;
  discord: REST;
  /**
   * Optional external abort signal — when omitted an internal controller is allocated so callers can still
   * {@link DiscordStreamingBridge.dispose | dispose} cleanly.
   */
  signal?: AbortSignal | undefined;

  starterContent?: string | undefined;

  hooks?: SessionStreamHooks | undefined;

  onStreamError?: ((error: unknown) => void) | undefined;

  reconnectBaseMs?: number | undefined;

  reconnectMaxMs?: number | undefined;
}>;

export type DiscordStreamingBridge = Readonly<{
  pump: DiscordEditPump;
  manager: SessionStreamManager;

  ingest: (event: GlobalEvent) => void;

  dispose: () => Promise<void>;
}>;

/** Opinionated pairing of SSE ingestion with Discord edits. */

export function createDiscordStreamingBridge(options: DiscordStreamingBridgeOptions): DiscordStreamingBridge {
  const ownsSignal = options.signal === undefined ? new AbortController() : undefined;

  const signal = options.signal ?? ownsSignal!.signal;

  const pump = new DiscordEditPump();

  const manager = new SessionStreamManager({
    rest: options.discord,

    pump,
    starterContent: options.starterContent,
    hooks: options.hooks,
  });

  void runOpencodeGlobalEventSubscriber({
    client: options.opencode,
    signal,
    reconnectBaseMs: options.reconnectBaseMs,
    reconnectMaxMs: options.reconnectMaxMs,

    onTransportError: options.onStreamError,

    onEvent: (evt) => {
      manager.ingest(evt);
    },
  });

  return {
    pump,

    manager,
    ingest: (event) => {
      ingestDefaultDiscordRelayEvents(manager, event);
    },
    dispose: async () => {
      ownsSignal?.abort();
      await pump.idle();
    },
  };
}

export function ingestDefaultDiscordRelayEvents(manager: SessionStreamManager, event: GlobalEvent): void {
  manager.ingest(event);
}
