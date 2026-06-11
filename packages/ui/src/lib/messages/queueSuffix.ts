// Explicit queue markers at the end of a message (ported from the Otto
// Discord bot). Supported forms:
// - punctuation + queue: ". queue", "! queue", ". queue.", "!queue."
// - queue as its own final line: "text\nqueue"
// When present the suffix is stripped and the message is routed through the
// local message queue instead of being sent immediately.
const QUEUE_SUFFIX_RE = /(?:[.!?,;:])\s*queue\.?\s*$|\n\s*queue\.?\s*$/i;

export interface QueueSuffixResult {
  prompt: string;
  forceQueue: boolean;
}

export function extractQueueSuffix(prompt: string): QueueSuffixResult {
  if (!QUEUE_SUFFIX_RE.test(prompt)) {
    return { prompt, forceQueue: false };
  }
  return { prompt: prompt.replace(QUEUE_SUFFIX_RE, '').trimEnd(), forceQueue: true };
}
