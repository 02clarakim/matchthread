import type { ApiHighlight } from "@/lib/types/api";
import { Badge } from "@/components/ui/badge";

const METHOD_LABEL: Record<ApiHighlight["matchingMethod"], string> = {
  DETERMINISTIC: "exact match",
  FUZZY: "similarity match",
  SEMANTIC: "AI match",
};

/** redditmedia.com's `?embed=true` player — one iframe works for every clip host (v.redd.it, streamff, …). */
function isRedditEmbed(url: string): boolean {
  return url.includes("redditmedia.com") && url.includes("embed=true");
}

/**
 * Media, when present, is an embed or an outbound link — never a re-host.
 * We never download or store the file ourselves (see README § Reliability /
 * Media Handling).
 *
 *  - Native Reddit video (v.redd.it) → Reddit's own `redditmedia.com`
 *    iframe player, inline with audio.
 *  - An external clip host (streamin.link, streamff, …) can't be framed
 *    cleanly, so we show a one-click "watch" panel that opens the clip's
 *    own page directly — no nested Reddit card to click through.
 *  - Otherwise a direct <video>/<img>, and failing that just the title
 *    link below — never a fake/broken player.
 */
function HighlightMedia({ highlight }: { highlight: ApiHighlight }) {
  const { mediaUrl, mediaType, clipUrl, clipHost, videoUrl, posterUrl } = highlight.socialPost;

  // Best case: a direct .mp4 resolved from the clip host — plays inline, with sound.
  if (videoUrl) {
    return (
      <div className="mb-2">
        <video
          controls
          playsInline
          preload="metadata"
          poster={posterUrl ?? undefined}
          src={videoUrl}
          className="max-h-72 w-full rounded-md bg-black"
        />
        {clipUrl && (
          <a
            href={clipUrl}
            target="_blank"
            rel="noopener noreferrer nofollow"
            className="mt-1 block text-xs text-muted hover:text-accent"
          >
            Trouble playing? Open on {clipHost ?? "the clip host"} ↗
          </a>
        )}
      </div>
    );
  }

  // Fallback: we know the clip host but haven't resolved a playable file yet.
  if (clipUrl) {
    return (
      <a
        href={clipUrl}
        target="_blank"
        rel="noopener noreferrer nofollow"
        className="mb-2 flex items-center gap-3 rounded-md border border-border bg-black/40 px-3 py-4 hover:border-accent/60 transition-colors"
      >
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-accent text-black">▶</span>
        <span className="min-w-0">
          <span className="block text-sm font-medium">Watch goal clip</span>
          <span className="block truncate text-xs text-muted">opens {clipHost ?? "the clip host"} ↗</span>
        </span>
      </a>
    );
  }

  if (!mediaUrl) return null;

  if (mediaType === "VIDEO" && isRedditEmbed(mediaUrl)) {
    return (
      <iframe
        src={mediaUrl}
        title={highlight.socialPost.title}
        loading="lazy"
        scrolling="no"
        sandbox="allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox allow-presentation"
        allow="fullscreen; encrypted-media"
        className="mb-2 h-96 w-full rounded-md border-0 bg-black"
      />
    );
  }

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
