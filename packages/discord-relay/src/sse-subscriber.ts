import type { GlobalEvent, OpencodeClient } from "@opencode-ai/sdk";

export type GlobalEventSubscriberOptions = Readonly<{
  /** Bound OpenCode daemon client (@opencode-ai/sdk). */
  client: OpencodeClient;

  /** One callback per streamed global envelope. */
  onEvent: (event: GlobalEvent) => void;

  /** Raised on transport failures after the SDK exhausts its SSE retry budget or on parser errors. */
  onTransportError?: ((error: unknown) => void) | undefined;

  /** Cooperative shutdown toggle — abort closes the outbound fetch + breaks the reconnect loop. */
  signal?: AbortSignal | undefined;

  reconnectBaseMs?: number | undefined;

  reconnectMaxMs?: number | undefined;
}>;

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** Reconnect wrapper with exponential backoff layered on top of the SDK SSE helper. */
export function runOpencodeGlobalEventSubscriber(options: GlobalEventSubscriberOptions): Promise<void> {
  return consumeForever(options);
}

async function consumeForever(options: GlobalEventSubscriberOptions): Promise<void> {
  const base = options.reconnectBaseMs ?? 1000;
  const ceiling = options.reconnectMaxMs ?? 30_000;

  let failures = 0;

  while (options.signal?.aborted !== true) {
    try {
      const streamResult = await options.client.global.event({
        signal: options.signal,
        sseDefaultRetryDelay: base,
        sseMaxRetryDelay: ceiling,
      });

      failures = 0;

      for await (const chunk of streamResult.stream) {
        if (options.signal?.aborted) return;
        options.onEvent(chunk as GlobalEvent);
      }

      failures += 1;
      options.onTransportError?.(new Error("OpenCode closed the SSE socket"));
    } catch (error) {
      if (options.signal?.aborted) return;

      failures += 1;
      options.onTransportError?.(error);
    }

    const backoff = Math.min(ceiling, base * 2 ** Math.min(failures, 8));
    await sleep(backoff);
  }
}
