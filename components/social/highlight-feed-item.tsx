import Link from "next/link";
import type { ApiHighlight } from "@/lib/types/api";

interface HighlightFeedItemProps {
  highlight: ApiHighlight;
  matchId: string;
  matchLabel: string;
}

export function HighlightFeedItem({ highlight, matchId, matchLabel }: HighlightFeedItemProps) {
  return (
    <Link
      href={`/matches/${matchId}`}
      className="block rounded-lg border border-border bg-surface p-3 hover:border-accent/50 transition-colors"
    >
      <div className="text-xs text-muted mb-1">{matchLabel}</div>
      <p className="text-sm leading-snug">{highlight.socialPost.title}</p>
    </Link>
  );
}
