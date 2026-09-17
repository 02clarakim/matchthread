/**
 * Every r/soccer goal-clip post links out to *something* — v.redd.it, or a
 * mirror host (streamff, streamin, dubz, …). Reddit's own embed page
 * (embed.reddit.com) carries that outbound URL in a JSON blob, so we can
 * read it with a plain fetch — no API key, no fetchlayer. Pair this with
 * lib/reddit/resolve-clip.ts to turn a mirror-host link into a direct .mp4.
 */

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36";

export interface PostOutbound {
  /** Where the post points — a v.redd.it URL or a mirror-host watch page. */
  outboundUrl: string;
  host: string;
  isNativeVideo: boolean;
}

/** @param permalink e.g. "/r/soccer/comments/1w3pl4h/aston_villa_0_1_arsenal_bukayo_saka_59/" */
export async function resolveRedditPostOutbound(permalink: string): Promise<PostOutbound | null> {
  const url = `https://embed.reddit.com${permalink.startsWith("/") ? "" : "/"}${permalink}?ref_source=embed&ref=share&embed=true`;
  let html: string;
  try {
    const res = await fetch(url, { redirect: "follow", headers: { "user-agent": UA } });
    if (!res.ok) return null;
    html = await res.text();
  } catch {
    return null;
  }

  // ...&quot;post&quot;:{&quot;id&quot;:&quot;t3_1w3pl4h&quot;,&quot;url&quot;:&quot;https://streamff.pro/v/0072d881&quot;...
  const m =
    html.match(/&quot;post&quot;:\{&quot;id&quot;:&quot;t3_[a-z0-9]+&quot;,&quot;url&quot;:&quot;([^&]+)&quot;/i) ??
    html.match(/"post":\{"id":"t3_[a-z0-9]+","url":"([^"]+)"/i);
  const outboundUrl = m?.[1]?.trim();
  if (!outboundUrl || !/^https?:\/\//i.test(outboundUrl)) return null;

  let host: string;
  try {
    host = new URL(outboundUrl).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
  // A self-permalink means Reddit hosts the media itself (v.redd.it) — the
  // `url` field then points back at reddit.com; treat that as native.
  const isSelf = /(^|\.)reddit\.com$/i.test(host);
  return {
    outboundUrl: isSelf ? `https://www.reddit.com${permalink}` : outboundUrl,
    host: isSelf ? "v.redd.it" : host,
    isNativeVideo: isSelf || host === "v.redd.it",
  };
}
