import type { ApiHighlight } from "@/lib/types/api";
import { Badge } from "@/components/ui/badge";

const METHOD_LABEL: Record<ApiHighlight["matchingMethod"], string> = {
  DETERMINISTIC: "exact match",
  FUZZY: "similarity match",
  SEMANTIC: "AI match",
};

/**
 * Media, when present, streams directly from Reddit's own CDN
 * (v.redd.it / preview.redd.it) — this is an embed, not a re-host. We
 * never download or store the file ourselves (see README § Reliability /
 * Media Handling). If Reddit doesn't offer embeddable media for a post,
 * we fall back to a plain link — never a fake/broken player.
 */
function HighlightMedia({ highlight }: { highlight: ApiHighlight }) {
  const { mediaUrl, mediaType } = highlight.socialPost;
  if (!mediaUrl) return null;

  if (mediaType === "VIDEO") {
    return (
      <video
        controls
        playsInline
        preload="metadata"
        className="mb-2 max-h-72 w-full rounded-md bg-black"
        src={mediaUrl}
      />
    );
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={mediaUrl}
      alt=""
      className="mb-2 max-h-72 w-full rounded-md object-cover"
      onError={(e) => {
        e.currentTarget.style.display = "none";
      }}
    />
  );
}

export function HighlightCard({ highlight, rank }: { highlight: ApiHighlight; rank: number }) {
  return (
    <div className="rounded-lg border border-border bg-surface-2 p-3">
      <div className="flex items-center justify-between gap-2 mb-1.5">
        <span className="text-xs font-medium text-accent">
          {rank === 0 ? "🔥 Best reaction" : "💬 Discussion"}
        </span>
        <Badge title={`Match score ${highlight.score.toFixed(2)}`}>
          {METHOD_LABEL[highlight.matchingMethod]} · {Math.round(highlight.score * 100)}%
        </Badge>
      </div>

      <HighlightMedia highlight={highlight} />

      <a
        href={highlight.socialPost.url}
        target="_blank"
        rel="noopener noreferrer nofollow"
        className="block hover:opacity-80 transition-opacity"
      >
        <p className="text-sm leading-snug">{highlight.socialPost.title}</p>
        <div className="mt-1.5 text-xs text-muted">
          {highlight.socialPost.author && <span>u/{highlight.socialPost.author} · </span>}
          View on Reddit →
        </div>
      </a>
    </div>
  );
}
