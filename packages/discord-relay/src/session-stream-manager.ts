import type {
  AssistantMessage,
  FileDiff,
  GlobalEvent,
  Message,
  PatchPart,
  Part,
  ReasoningPart,
  TextPart,
  ToolPart,
} from "@opencode-ai/sdk";
import { REST } from "@discordjs/rest";

import { DiscordEditPump } from "./discord-edit-pump";

import { composeDiscordPayload, formatDiffBlock } from "./discord-formatter";

import { createStreamingStarterMessage, patchStreamingMessage } from "./discord-rest-sink";

export type SessionStreamHooks = Readonly<{
  /**
   * Mirrors the OpenCode-side `tool.execute.before` hook semantics — fired from SSE
   * `message.part.updated` events while the tool invocation is still `pending`.
   */
  onToolExecuteBefore?: ((input: Readonly<{ sessionId: string; part: ToolPart }>) => void) | undefined;
}>;

export type SessionStreamManagerOptions = Readonly<{
  rest: REST;
  pump: DiscordEditPump;
  starterContent?: string | undefined;
  hooks?: SessionStreamHooks | undefined;
}>;

type SessionTopicState = Readonly<{
  channelId?: string | undefined;
  messageId?: string | undefined;
  hadTranscript: boolean;
  segmentOrder: string[];
  segments: Map<string, string>;
  toolsOrder: string[];
  tools: Map<string, ToolPart>;
  diffSnippets: string[];
  banners: string[];
  idle: boolean;
}>;

const starterDefault = "_Streaming OpenCode session…_";

export class SessionStreamManager {
  private readonly rest: REST;

  private readonly pump: DiscordEditPump;

  private readonly starterContent: string;

  private readonly hooks: SessionStreamHooks | undefined;

  private readonly sessions = new Map<string, SessionTopicState>();

  public constructor(options: SessionStreamManagerOptions) {
    this.rest = options.rest;
    this.pump = options.pump;
    this.starterContent = options.starterContent ?? starterDefault;
    this.hooks = options.hooks;
  }

  /** Binds a Discord channel that should receive streamed updates for a session. */
  public bindSession(sessionId: string, channelId: string): void {
    const state = this.ensure(sessionId);
    this.commit(sessionId, { ...state, channelId });
    this.enqueueFlush(sessionId);
  }

  /** Entry point consumed by the OpenCode SSE subscriber. */
  public ingest(event: GlobalEvent): void {
    const payload = event.payload;

    switch (payload.type) {
      case "message.updated": {
        this.onAssistantMessage(payload.properties.info);
        return;
      }

      case "message.part.updated": {
        this.onPartUpdated(payload.properties.part, payload.properties.delta);
        return;
      }

      case "session.diff": {
        this.onDiff(payload.properties.sessionID, payload.properties.diff);
        return;
      }

      case "session.idle": {
        this.onIdle(payload.properties.sessionID);
        return;
      }

      default: {
        return;
      }
    }
  }

  private commit(sessionId: string, next: SessionTopicState): void {
    this.sessions.set(sessionId, next);
  }

  private onAssistantMessage(message: Message): void {
    if (message.role !== "assistant") return;
    const sessionId = message.sessionID;

    if (!message.error) return;

    const summary = `\`assistant message error\` • ${summarizeAssistantError(message)}`;
    const merged = this.mergeBanner(this.ensure(sessionId), summary);
    this.commit(sessionId, merged);
    this.enqueueFlush(sessionId);
  }

  private onIdle(sessionId: string): void {
    const base = this.ensure(sessionId);
    const next = this.mergeBannerState({ ...base, idle: true }, "> **session.idle**");
    this.commit(sessionId, next);
    this.enqueueFlush(sessionId);
  }

  private onDiff(sessionId: string, diffs: ReadonlyArray<FileDiff>): void {
    const state = this.ensure(sessionId);
    const buffer = [...state.diffSnippets];

    for (const diff of diffs) {
      buffer.push(formatDiffBlock(diff));
      if (buffer.length > 6) buffer.shift();
    }

    this.commit(sessionId, { ...state, diffSnippets: buffer });
    this.enqueueFlush(sessionId);
  }

  private onPartUpdated(part: Part, delta: string | undefined): void {
    const sessionId = part.sessionID;
    let state = this.ensure(sessionId);

    if (part.type === "tool") {
      if (part.state.status === "pending") this.hooks?.onToolExecuteBefore?.({ sessionId, part });

      state = this.touchTool(state, part);
      this.commit(sessionId, state);
      this.enqueueFlush(sessionId);
      return;
    }

    if (part.type === "text") {
      state = this.mergeTextSegment(state, part, delta);
      this.commit(sessionId, state);
      this.enqueueFlush(sessionId);
      return;
    }

    if (part.type === "reasoning") {
      state = this.mergeReasoningSegment(state, part, delta);
      this.commit(sessionId, state);
      this.enqueueFlush(sessionId);
      return;
    }

    if (part.type === "patch") {
      state = this.mergePatchSegment(state, part);
      this.commit(sessionId, state);
      this.enqueueFlush(sessionId);
    }
  }

  private mergeBanner(state: SessionTopicState, banner: string): SessionTopicState {
    return this.mergeBannerState(state, banner);
  }

  private mergeBannerState(state: SessionTopicState, banner: string): SessionTopicState {
    const banners = [...state.banners, banner];
    const trimmed = banners.length > 6 ? banners.slice(banners.length - 6) : banners;
    return { ...state, banners: trimmed };
  }

  private touchTool(state: SessionTopicState, part: ToolPart): SessionTopicState {
    const tools = new Map(state.tools);
    tools.set(part.callID, part);

    const order = state.toolsOrder.filter((id) => id !== part.callID);
    order.push(part.callID);

    return { ...state, tools, toolsOrder: order };
  }

  private mergeTextSegment(state: SessionTopicState, part: TextPart, delta: string | undefined): SessionTopicState {
    const key = `text:${part.id}`;
    const nextValue = accumulateTextSegment(state.segments.get(key), delta, part.text);
    return this.upsertSegment(state, key, nextValue);
  }

  private mergeReasoningSegment(state: SessionTopicState, part: ReasoningPart, delta: string | undefined): SessionTopicState {
    const key = `reason:${part.id}`;
    const nextValue = accumulateTextSegment(state.segments.get(key), delta, part.text);
    return this.upsertSegment(state, key, nextValue);
  }

  private mergePatchSegment(state: SessionTopicState, part: PatchPart): SessionTopicState {
    const key = `patch:${part.id}:${part.hash}`;
    const touched = escapeUnderscores(part.files.join(", "));
    const markdown = `${wrapSegmentHeader("Patch", `**hash** \`${escapeBackticks(part.hash)}\`\n📂 ${touched}`)}`;
    return this.upsertSegment(state, key, markdown);
  }

  private upsertSegment(state: SessionTopicState, key: string, value: string): SessionTopicState {
    const segments = new Map(state.segments);
    segments.set(key, value);

    const order = [...state.segmentOrder.filter((existing) => existing !== key)];
    order.push(key);

    return { ...state, segments, segmentOrder: order };
  }

  private ensure(sessionId: string): SessionTopicState {
    let state = this.sessions.get(sessionId);
    if (state !== undefined) return state;

    state = {
      hadTranscript: false,
      segmentOrder: [],
      segments: new Map(),
      toolsOrder: [],
      tools: new Map(),
      diffSnippets: [],
      banners: [],
      idle: false,
    };

    this.commit(sessionId, state);
    return state;
  }

  private enqueueFlush(sessionId: string): void {
    this.pump.enqueue(async () => {
      await this.flush(sessionId);
    });
  }

  private async flush(sessionId: string): Promise<void> {
    let state = this.sessions.get(sessionId);
    if (state === undefined) return;

    const channelId = state.channelId;
    if (channelId === undefined) return;

    let messageId = state.messageId ?? undefined;

    try {
      if (messageId === undefined) {
        const created = await createStreamingStarterMessage({
          rest: this.rest,
          channelId,
          starterContent: this.starterContent,
        });
        messageId = created.id;
        state = this.ensure(sessionId);
        this.commit(sessionId, { ...state, messageId });
      }

      const latest = this.ensure(sessionId);

      const markdownBody = assembleMarkdown(latest);

      const orderedTools = latest.toolsOrder
        .map((id): ToolPart | undefined => latest.tools.get(id))
        .filter((item): item is ToolPart => item !== undefined);

      const composed = composeDiscordPayload({
        markdownBody,
        tools: orderedTools.slice(-10),
      });

      await patchStreamingMessage({
        rest: this.rest,
        channelId,
        messageId: messageId!,
        patch: {
          content: composed.contentOrStub,
          embeds: composed.embeds,
          transcript: composed.transcript,
          stripAttachments: latest.hadTranscript && composed.transcript === undefined,
        },
      });

      const reconciled = this.ensure(sessionId);
      this.commit(sessionId, { ...reconciled, messageId, hadTranscript: composed.transcript !== undefined });
    } catch (error: unknown) {
      const degraded = this.mergeBanner(this.ensure(sessionId), `Discord relay error • ${stringifyError(error)}`);
      this.commit(sessionId, { ...degraded, channelId: state.channelId, messageId: messageId ?? state.messageId });
      console.error("[discord-relay]", error);
    }
  }
}

function assembleMarkdown(state: SessionTopicState): string {
  const chunks: string[] = [];

  if (state.banners.length) chunks.push(state.banners.join("\n"));

  const segments = state.segmentOrder
    .map((key): string | undefined => {
      const raw = state.segments.get(key);
      if (raw === undefined) return undefined;
      return decorateSegment(key, raw);
    })
    .filter((value): value is string => value !== undefined && value.trim().length > 0);

  if (segments.length) chunks.push(segments.join("\n\n"));

  if (state.diffSnippets.length) chunks.push(state.diffSnippets.join("\n\n"));

  const body = chunks.join("\n\n").trim();
  return body.length > 0 ? body : "_…waiting for model output…_";
}

function decorateSegment(key: string, value: string): string {
  if (key.startsWith("patch:")) return value;

  if (key.startsWith("reason:")) {
    return wrapSegmentBody("Reasoning", blockquote(value));
  }

  if (key.startsWith("text:")) {
    return wrapSegmentBody("Assistant", value);
  }

  return wrapSegmentBody("Update", value);
}

function wrapSegmentHeader(title: string, body: string): string {
  return wrapSegmentBody(title, body);
}

function wrapSegmentBody(title: string, body: string): string {
  return `### ${title}\n${body}`;
}

function accumulateTextSegment(prior: string | undefined, delta: string | undefined, snapshot: string): string {
  if (delta !== undefined && delta.length > 0) {
    return `${prior ?? ""}${delta}`;
  }

  return snapshot;
}

function blockquote(body: string): string {
  if (body.trim().length === 0) return "> …";
  return body
    .split("\n")
    .map((line) => `> ${line}`)
    .join("\n");
}

function escapeUnderscores(value: string): string {
  return value.replaceAll("_", "\\_").replaceAll("*", "\\*");
}

function escapeBackticks(value: string): string {
  return value.replaceAll("`", "'");
}

function stringifyError(error: unknown): string {
  if (error instanceof Error) return `${error.name}: ${error.message}`.slice(0, 500);
  return JSON.stringify(error).slice(0, 500);
}

function summarizeAssistantError(message: AssistantMessage): string {
  const err = message.error;

  if (!err) return "unknown assistant error";

  switch (err.name) {
    case "APIError":
      return `${err.name}: ${err.data.message}`;
    case "UnknownError":
      return `${err.name}: ${err.data.message}`;
    case "ProviderAuthError":
      return `${err.name}: ${err.data.message}`;
    case "MessageOutputLengthError":
      return `${err.name}`;
    default:
      return JSON.stringify(err);
  }
}
