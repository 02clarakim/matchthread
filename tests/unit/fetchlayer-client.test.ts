import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isFetchlayerConfigured, searchGoalClipPosts } from "@/lib/reddit/fetchlayer-client";

describe("isFetchlayerConfigured / searchGoalClipPosts (graceful degradation)", () => {
  const original = process.env.FETCHLAYER_API_KEY;

  afterEach(() => {
    if (original === undefined) delete process.env.FETCHLAYER_API_KEY;
    else process.env.FETCHLAYER_API_KEY = original;
    vi.unstubAllGlobals();
  });

  it("reports unconfigured when no key is set", () => {
    delete process.env.FETCHLAYER_API_KEY;
    expect(isFetchlayerConfigured()).toBe(false);
  });

  it("reports configured once a key is set", () => {
    process.env.FETCHLAYER_API_KEY = "ss-test-key";
    expect(isFetchlayerConfigured()).toBe(true);
  });

  it("returns [] with no network call at all when unconfigured", async () => {
    delete process.env.FETCHLAYER_API_KEY;
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const result = await searchGoalClipPosts();
    expect(result).toEqual([]);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("returns [] (not a throw) when the API responds with an error status", async () => {
    process.env.FETCHLAYER_API_KEY = "ss-test-key";
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 401 }));
    const result = await searchGoalClipPosts();
    expect(result).toEqual([]);
  });

  it("returns [] (not a throw) on a network error", async () => {
    process.env.FETCHLAYER_API_KEY = "ss-test-key";
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network down")));
    const result = await searchGoalClipPosts();
    expect(result).toEqual([]);
  });
});

describe("searchGoalClipPosts mapping", () => {
  const original = process.env.FETCHLAYER_API_KEY;

  beforeEach(() => {
    process.env.FETCHLAYER_API_KEY = "ss-test-key";
  });

  afterEach(() => {
    if (original === undefined) delete process.env.FETCHLAYER_API_KEY;
    else process.env.FETCHLAYER_API_KEY = original;
    vi.unstubAllGlobals();
  });

  it("maps a real-shaped FetchLayer response into ClipInput, normalizing the absolute permalink to a relative one", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          items: [
            {
              id: "1wlyfcw",
              title: "Inter Miami 2 - [2] San Diego FC - Anders Dreyer 82'",
              author: "eliseihado",
              permalink: "https://www.reddit.com/r/soccer/comments/1wlyfcw/inter_miami_2_2_san_diego_fc_anders_dreyer_82/",
              createdAt: "2026-09-21T01:01:41.456Z",
            },
          ],
        }),
      })
    );

    const [clip] = await searchGoalClipPosts();
    expect(clip).toEqual({
      postId: "1wlyfcw",
      title: "Inter Miami 2 - [2] San Diego FC - Anders Dreyer 82'",
      permalink: "/r/soccer/comments/1wlyfcw/inter_miami_2_2_san_diego_fc_anders_dreyer_82/",
      author: "eliseihado",
      createdAt: "2026-09-21T01:01:41.456Z",
      sourceUrl: "https://www.reddit.com/r/soccer/comments/1wlyfcw/inter_miami_2_2_san_diego_fc_anders_dreyer_82/",
      sourceHost: "reddit",
    });
  });

  it("sends the goal-clip flair query, restricted to r/soccer, for the last day", async () => {
    const fetchSpy = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ items: [] }) });
    vi.stubGlobal("fetch", fetchSpy);

    await searchGoalClipPosts();

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe("https://api.fetchlayer.dev/reddit/search");
    expect(init.headers.Authorization).toBe("Bearer ss-test-key");
    const body = JSON.parse(init.body);
    expect(body).toMatchObject({ subreddit: "soccer", sort: "new", time: "day" });
    expect(body.query).toContain("Goal Clip");
  });
});
