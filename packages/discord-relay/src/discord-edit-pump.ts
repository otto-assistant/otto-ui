import { MIN_DISCORD_EDIT_INTERVAL_MS } from "./constants";

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

export type DiscordEditPumpOptions = Readonly<{
  minIntervalMs?: number | undefined;
}>;

/**
 * Enforces pacing between outbound Discord edits and collapses bursts by always applying only the
 * latest pending payload inside the drain loop.
 */
export class DiscordEditPump {
  private readonly minIntervalMs: number;

  private lastExecutedAt = 0;

  private pendingRun: (() => Promise<void>) | undefined;

  private chain: Promise<void> = Promise.resolve();

  public constructor(opts: DiscordEditPumpOptions | undefined = undefined) {
    this.minIntervalMs = opts?.minIntervalMs ?? MIN_DISCORD_EDIT_INTERVAL_MS;
  }

  public enqueue(edit: () => Promise<void>): void {
    this.pendingRun = edit;
    this.chain = this.chain.then(() => this.drain());
  }

  public idle(): Promise<void> {
    return this.chain;
  }

  private async drain(): Promise<void> {
    while (this.pendingRun !== undefined) {
      const run = this.pendingRun;
      this.pendingRun = undefined;

      const elapsed = Date.now() - this.lastExecutedAt;
      const waitMs = Math.max(0, this.minIntervalMs - elapsed);
      if (waitMs > 0) await sleep(waitMs);

      await run();
      this.lastExecutedAt = Date.now();
    }
  }
}
