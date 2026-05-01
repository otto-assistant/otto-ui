import { REST } from "@discordjs/rest";
import type {
  APIMessage,
  APIEmbed,
  RESTPatchAPIChannelMessageJSONBody,
  RESTPostAPIChannelMessageJSONBody,
} from "discord-api-types/v10";
import { Routes } from "discord-api-types/v10";

export type StreamingPatchArgs = Readonly<{
  content: string;
  embeds?: APIEmbed[] | undefined;
  transcript?: Readonly<{ name: string; data: Uint8Array }>;
  stripAttachments?: boolean | undefined;
}>;

export async function createStreamingStarterMessage(options: Readonly<{ rest: REST; channelId: string; starterContent: string }>): Promise<APIMessage> {
  const starter: RESTPostAPIChannelMessageJSONBody = {
    content: options.starterContent.slice(0, 2000),
  };

  return (await options.rest.post(Routes.channelMessages(options.channelId), {
    body: starter,
  })) as APIMessage;
}

export async function patchStreamingMessage(options: Readonly<{ rest: REST; channelId: string; messageId: string; patch: StreamingPatchArgs }>): Promise<APIMessage> {
  const body: RESTPatchAPIChannelMessageJSONBody = {};

  body.content = options.patch.content.slice(0, 2000);
  body.embeds = options.patch.embeds && options.patch.embeds.length ? options.patch.embeds : [];

  const files =
    options.patch.transcript !== undefined
      ? [
          {
            name: options.patch.transcript.name,
            data: options.patch.transcript.data,
          },
        ]
      : undefined;

  if (files?.length) {
    body.attachments = [{ id: 0 }] as RESTPatchAPIChannelMessageJSONBody["attachments"];
  } else if (options.patch.stripAttachments) {
    body.attachments = [];
  }

  const response = files?.length
    ? await options.rest.patch(Routes.channelMessage(options.channelId, options.messageId), {
        body,
        files,
      })
    : await options.rest.patch(Routes.channelMessage(options.channelId, options.messageId), {
        body,
      });

  return response as APIMessage;
}
