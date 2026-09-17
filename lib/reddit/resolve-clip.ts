/**
 * r/soccer goal clips that link out to a mirror host (streamff*, streamin*,
 * dubz, …) can't be iframed — but every one of those hosts exposes a plain
 * .mp4 with no hotlink protection. This fetches the watch page and pulls
 * the direct file so the UI can play it inline in a <video> tag.
 *
 * Plain fetch, no fetchlayer — these hosts are reachable directly.
 */

export interface ResolvedClip {
  videoUrl: string;
  posterUrl: string | null;
}

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36";

function metaContent(html: string, property: string): string | null {
  const re = new RegExp(
    `<meta[^>]+(?:property|name)=['"]${property.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}['"][^>]*>`,
    "i"
  );
  const tag = html.match(re)?.[0];
  if (!tag) return null;
  return tag.match(/content=['"]([^'"]+)['"]/i)?.[1]?.trim() ?? null;
}

function firstSourceMp4(html: string): string | null {
  const m = html.match(/<source[^>]+src=['"]([^'"]+\.mp4[^'"]*)['"]/i);
  return m?.[1] ?? null;
}

function clean(url: string | null): string | null {
  if (!url) return null;
  return url.split("#")[0].trim();
}

/**
 * @param clipUrl the post's outbound URL, e.g. https://streamin.link/v/ab12
 */
export async function resolveClip(clipUrl: string): Promise<ResolvedClip | null> {
  let res: Response;
  try {
    res = await fetch(clipUrl, { redirect: "follow", headers: { "user-agent": UA } });
  } catch {
    return null;
  }
  if (!res.ok) return null;
  const finalUrl = res.url || clipUrl;
  const html = await res.text();
  const id = finalUrl.match(/\/v\/([A-Za-z0-9_-]+)/)?.[1] ?? clipUrl.match(/\/v\/([A-Za-z0-9_-]+)/)?.[1] ?? null;

  // streamff family: og:video is self-referential; the real file sits on
  // cdn.hostedhost.top keyed by the clip id. (Its .jpg poster 404s, so
  // none — the player falls back to the video's own first frame.)
  if (/streamff\.|hostedhost\.top/i.test(finalUrl) || /streamff/i.test(clipUrl)) {
    if (id) return { videoUrl: `https://cdn.hostedhost.top/${id}.mp4`, posterUrl: null };
  }

  // streamin family + generic: trust og:video / <source>.
  const og =
    clean(metaContent(html, "og:video:secure_url")) ??
    clean(metaContent(html, "og:video:url")) ??
    clean(metaContent(html, "og:video")) ??
    clean(firstSourceMp4(html));
  if (og && /\.mp4(\?|$)/i.test(og) && !/\/v\/[A-Za-z0-9_-]+$/.test(og)) {
    const poster =
      clean(metaContent(html, "og:image")) ??
      clean(metaContent(html, "twitter:image")) ??
      (id && /streamin/i.test(finalUrl) ? `https://cdn.streamin.top/images/${id}.jpg` : null);
    return { videoUrl: og, posterUrl: poster };
  }

  return null;
}
