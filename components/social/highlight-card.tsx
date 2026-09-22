import type { ApiHighlight } from "@/lib/types/api";

function isRedditEmbed(url: string | null): boolean {
  return Boolean(url && url.includes("redditmedia.com") && url.includes("embed=true"));
}

/**
 * Media, when present, is an embed or an outbound link — never a re-host
 * (see README § Reliability / Media Handling). In priority order:
 *
 *  1. `videoUrl` — a direct .mp4 resolved from the mirror host
 *     (scripts/resolve-clip-media.ts). Plays inline in a <video>, with
 *     sound. The `#t=0.1` fragment shows the first frame instead of black.
 *  2. Native Reddit video (v.redd.it) → Reddit's `redditmedia.com` iframe.
 *  3. A mirror host we couldn't resolve to a file → a compact "watch"
 *     button, NOT the tall Reddit iframe (which just renders a black card
 *     for an off-Reddit link).
 *  4. Otherwise a plain <video>/<img>, else nothing.
 */
function HighlightMedia({ highlight }: { highlight: ApiHighlight }) {
  const { mediaUrl, mediaType, clipUrl, clipHost, videoUrl, posterUrl } = highlight.socialPost;
  const isNative = clipHost === "v.redd.it" || (isRedditEmbed(mediaUrl) && !clipUrl && !clipHost);

  if (videoUrl) {
    return (
      <div className="mb-2">
        <video
          controls
          playsInline
          preload="metadata"
          poster={posterUrl ?? undefined}
          src={`${videoUrl}#t=0.1`}
          className="aspect-video w-full rounded-md bg-black object-contain"
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

  if (isNative && isRedditEmbed(mediaUrl)) {
    return (
      <iframe
        src={mediaUrl!}
        title={highlight.socialPost.title}
        loading="lazy"
        scrolling="no"
        sandbox="allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox allow-presentation"
        allow="fullscreen; encrypted-media"
        className="mb-2 h-96 w-full rounded-md border-0 bg-black"
      />
    );
  }

  // A mirror host with no playable file yet — one deliberate click out, no black box.
  if (clipUrl) {
    return (
      <a
        href={clipUrl}
        target="_blank"
        rel="noopener noreferrer nofollow"
        className="mb-2 flex items-center gap-3 rounded-md border border-border bg-black/40 px-3 py-3 hover:border-accent/60 transition-colors"
      >
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accent text-black">▶</span>
        <span className="min-w-0">
          <span className="block text-sm font-medium">Watch goal clip</span>
          <span className="block truncate text-xs text-muted">opens {clipHost ?? "the clip host"} ↗</span>
        </span>
      </a>
    );
  }

  if (!mediaUrl) return null;

  if (mediaType === "VIDEO") {
    return (
      <video
        controls
        playsInline
        preload="metadata"
        className="mb-2 aspect-video w-full rounded-md bg-black object-contain"
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
      <span className="mb-1.5 block text-xs font-medium text-accent">
        {rank === 0 ? "🔥 Best reaction" : "💬 Discussion"}
      </span>

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
