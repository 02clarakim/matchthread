import { describe, expect, it } from "vitest";
import { extractMedia } from "@/lib/reddit/provider";
import type { RedditPost } from "@/lib/reddit/client";

function basePost(overrides: Partial<RedditPost>): RedditPost {
  return {
    id: "abc123",
    title: "Test post",
    selftext: "",
    author: "test_user",
    permalink: "/r/soccer/comments/abc123/test_post/",
    url: "https://reddit.com",
    thumbnail: "default",
    created_utc: 1700000000,
    score: 10,
    ...overrides,
  };
}

describe("extractMedia", () => {
  it("prefers a native Reddit-hosted video (v.redd.it) when present", () => {
    const post = basePost({
      is_video: true,
      media: { reddit_video: { fallback_url: "https://v.redd.it/abc123/DASH_720.mp4?source=fallback" } },
      preview: { images: [{ source: { url: "https://preview.redd.it/thumb.jpg" } }] },
    });
    const result = extractMedia(post);
    expect(result.mediaType).toBe("VIDEO");
    expect(result.mediaUrl).toBe("https://v.redd.it/abc123/DASH_720.mp4?source=fallback");
  });

  it("unescapes HTML-entity-encoded ampersands in the video URL", () => {
    const post = basePost({
      is_video: true,
      media: { reddit_video: { fallback_url: "https://v.redd.it/abc123/DASH_720.mp4?source=fallback&amp;foo=1" } },
    });
    expect(extractMedia(post).mediaUrl).toBe("https://v.redd.it/abc123/DASH_720.mp4?source=fallback&foo=1");
  });

  it("falls back to the full-size preview image for an image post", () => {
    const post = basePost({
      preview: { images: [{ source: { url: "https://preview.redd.it/full.jpg?width=1080&amp;auto=webp" } }] },
    });
    const result = extractMedia(post);
    expect(result.mediaType).toBe("IMAGE");
    expect(result.mediaUrl).toBe("https://preview.redd.it/full.jpg?width=1080&auto=webp");
  });

  it("falls back to url_overridden_by_dest for a direct image link post", () => {
    const post = basePost({
      post_hint: "image",
      url_overridden_by_dest: "https://i.redd.it/abc123.jpg",
    });
    expect(extractMedia(post)).toEqual({ mediaUrl: "https://i.redd.it/abc123.jpg", mediaType: "IMAGE" });
  });

  it("falls back to the thumbnail as a last resort", () => {
    const post = basePost({ thumbnail: "https://b.thumbs.redditmedia.com/xyz.jpg" });
    expect(extractMedia(post)).toEqual({ mediaUrl: "https://b.thumbs.redditmedia.com/xyz.jpg", mediaType: "IMAGE" });
  });

  it("returns no media for a plain text/link post with no thumbnail", () => {
    const post = basePost({ thumbnail: "self" });
    expect(extractMedia(post)).toEqual({ mediaUrl: null, mediaType: null });
  });
});
