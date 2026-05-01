import type { DiscordAuthor } from '../../../stores/useDiscordSyncStore';

interface DiscordBadgeProps {
  author: DiscordAuthor;
}

export function DiscordBadge({ author }: DiscordBadgeProps) {
  return (
    <span className="inline-flex items-center gap-1 rounded-sm bg-[#5865F2]/10 px-1.5 py-0.5 text-xs text-[#5865F2]">
      {author.avatar ? (
        <img
          src={author.avatar}
          alt={author.username}
          className="h-3.5 w-3.5 rounded-full"
        />
      ) : (
        <span className="flex h-3.5 w-3.5 items-center justify-center rounded-full bg-[#5865F2] text-[8px] font-bold text-white">
          {author.username.charAt(0).toUpperCase()}
        </span>
      )}
      <span className="font-medium">{author.username}</span>
      <span className="opacity-60">via Discord</span>
    </span>
  );
}
