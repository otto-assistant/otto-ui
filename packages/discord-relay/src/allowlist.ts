export type RelayAllowlists = Readonly<{
  userIds: ReadonlySet<string>;
  channelIds: ReadonlySet<string> | null;
}>;

export type AllowGateInput = Readonly<{
  userId: string;
  channelId: string | null;
  isDm: boolean;
}>;

export function createAllowGate(allowlists: RelayAllowlists) {
  return {
    ok(input: AllowGateInput): boolean {
      if (!allowlists.userIds.has(input.userId)) return false;
      if (input.isDm) return true;
      if (input.channelId == null) return false;
      if (allowlists.channelIds == null) return true;
      return allowlists.channelIds.has(input.channelId);
    },
  };
}
