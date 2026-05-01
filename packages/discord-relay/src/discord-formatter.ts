import type { FileDiff, ToolPart, ToolState } from "@opencode-ai/sdk";
import type { APIEmbed } from "discord-api-types/v10";

import { DISCORD_CONTENT_MAX } from "./constants";

const TOOL_STATUS_COLORS: Readonly<
  Record<ToolState["status"], number>
> = {
  pending: 0x5865_f2,
  running: 0xfee75c,
  completed: 0x57f287,
  error: 0xed4245,
};

export function formatDiffBlock(diff: FileDiff): string {
  const path = `\`${escapeBackticks(diff.file)}\``;
  const header = `### Diff — ${path} (+${diff.additions}/-${diff.deletions})`;
  const before = fence("Before", diff.before);
  const after = fence("After", diff.after);
  return `${header}\n${before}\n${after}`;
}

export function summarizeTool(part: ToolPart): APIEmbed {
  const footer = footerFor(part.state.status);
  return {
    color: TOOL_STATUS_COLORS[part.state.status],
    title: trimLength(`🔧 ${part.tool}`, 256),
    description: trimLength(bodyForTool(part), 3500),
    footer: { text: footer },
    timestamp: new Date().toISOString(),
  };
}

export type ComposeDiscordPayloadResult = Readonly<{
  contentOrStub: string;
  embeds: APIEmbed[];
  transcript?: Readonly<{ name: string; data: Uint8Array }>;
}>;

/**
 * Applies Discord `content` rules: if Markdown body exceeds Discord limits it returns a lightweight
 * stub in `content` and moves the raw payload into `transcript` for attachment uploads.
 */
export function composeDiscordPayload(args: Readonly<{ markdownBody: string; tools: ToolPart[] }>): ComposeDiscordPayloadResult {
  const toolEmbeds = args.tools.slice(-10).map(summarizeTool);
  let markdown = args.markdownBody.trimEnd();

  if (markdown.length === 0) {
    markdown = "_…_";
  }

  let contentOrStub = markdown;

  let transcript:
    | Readonly<{
        name: string;
        data: Uint8Array;
      }>
    | undefined;

  if (markdown.length > DISCORD_CONTENT_MAX) {
    transcript = {
      name: `opencode-session-${cryptoRandomSuffix()}.md`,
      data: new TextEncoder().encode(markdown),
    };

    contentOrStub = trimLength(`_Stream output (${markdown.length.toLocaleString()} chars) — full transcript attached as \`${transcript.name}\`._\n\n${previewHead(markdown)}`, DISCORD_CONTENT_MAX);
  }

  return { contentOrStub, embeds: toolEmbeds, transcript };
}

function bodyForTool(part: ToolPart): string {
  const state = part.state;
  if (state.status === "completed") {
    return [
      "```json",
      trimLength(JSON.stringify(state.input ?? {}, undefined, 2), 1200),
      "```",
      trimLength(state.output.trim(), 2000),
    ].join("\n");
  }

  if (state.status === "error") {
    return [
      "```json",
      trimLength(JSON.stringify(state.input ?? {}, undefined, 2), 1200),
      "```",
      trimLength(state.error.trim(), 2000),
    ].join("\n");
  }

  if (state.status === "running") {
    const titleLine = state.title ? `_${escapeBackticks(state.title)}_\n` : "";
    return `${titleLine}\`\`\`json\n${trimLength(JSON.stringify(state.input ?? {}, undefined, 2), 2600)}\n\`\`\``;
  }

  return `\`\`\`json\n${trimLength(JSON.stringify(state.input ?? {}, undefined, 2), 2600)}\n\`\`\``;
}

function footerFor(status: ToolState["status"]): string {
  switch (status) {
    case "completed":
      return "status: completed";
    case "error":
      return "status: error";
    case "pending":
      return "status: pending";
    default:
      return "status: running";
  }
}

function trimLength(value: string, max: number): string {
  if (value.length <= max) return value;
  const marker = `\n_(truncated, ${value.length.toLocaleString()} chars total)_`;
  const budget = Math.max(0, max - marker.length);
  return `${value.slice(0, budget)}${marker}`;
}

function previewHead(markdown: string): string {
  const prefixBudget = Math.min(markdown.length, 1400);
  const prefix = markdown.slice(0, prefixBudget);
  if (markdown.length <= prefixBudget) return prefix;
  return `${prefix}\n\n…`;
}

function escapeBackticks(value: string): string {
  return value.replaceAll("`", "'");
}

function fence(label: string, value: string): string {
  const body = value.trim().length === 0 ? "(empty)" : trimLength(value, 1600);
  return `**${label}**\n\`\`\`\n${body}\n\`\`\``;
}

function cryptoRandomSuffix(): string {
  if (typeof globalThis.crypto?.getRandomValues === "function") {
    const raw = new Uint32Array(2);
    globalThis.crypto.getRandomValues(raw);
    return `${raw[0].toString(16)}-${raw[1].toString(16)}`;
  }

  const legacy = `${Date.now()}${Math.random().toString(16).slice(2)}`;
  return legacy;
}
