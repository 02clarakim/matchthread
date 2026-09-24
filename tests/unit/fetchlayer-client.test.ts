import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isFetchlayerConfigured, searchGoalClipPosts, searchGoalClipPostsWide } from "@/lib/reddit/fetchlayer-client";

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
    const result = await searchGoalClipPosts("Arsenal", "Chelsea");
    expect(result).toEqual([]);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("returns [] (not a throw) when the API responds with an error status", async () => {
    process.env.FETCHLAYER_API_KEY = "ss-test-key";
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 401 }));
    const result = await searchGoalClipPosts("Arsenal", "Chelsea");
    expect(result).toEqual([]);
  });

  it("returns [] (not a throw) on a network error", async () => {
    process.env.FETCHLAYER_API_KEY = "ss-test-key";
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network down")));
    const result = await searchGoalClipPosts("Arsenal", "Chelsea");
    expect(result).toEqual([]);
  });
});

describe("searchGoalClipPosts", () => {
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

    const [clip] = await searchGoalClipPosts("Inter Miami", "San Diego FC");
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

  it("searches by team name (no flair filter — confirmed live that flair terms return zero results, see fetchlayer-client.ts doc comment), restricted to r/soccer, for the last day", async () => {
    const fetchSpy = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ items: [{ id: "x", title: "t", author: null, permalink: "/p", createdAt: "2026-01-01T00:00:00.000Z" }] }) });
    vi.stubGlobal("fetch", fetchSpy);

    await searchGoalClipPosts("Arsenal", "Chelsea");

    expect(fetchSpy).toHaveBeenCalledTimes(1); // found results on day 1 — no week fallback needed
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe("https://api.fetchlayer.dev/reddit/search");
    expect(init.headers.Authorization).toBe("Bearer ss-test-key");
    const body = JSON.parse(init.body);
    expect(body).toMatchObject({ subreddit: "soccer", sort: "new", time: "day" });
    expect(body.query).not.toMatch(/flair/i);
    expect(body.query).toBe("Arsenal Chelsea");
    // Pinned explicitly — see fetchlayer-client.ts's comment on this field.
    // FetchLayer was silently defaulting to 5 pages/call (each page billed
    // as its own credit) despite their own docs saying 1; this locks our
    // real cost to 1 credit/call regardless of what they default to.
    expect(body.pages).toBe(1);
  });

  it("uses a team's first known alias in the query — e.g. Atletico Madrid, not its full name twice", async () => {
    const fetchSpy = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ items: [{ id: "x", title: "t", author: null, permalink: "/p", createdAt: "2026-01-01T00:00:00.000Z" }] }) });
    vi.stubGlobal("fetch", fetchSpy);

    await searchGoalClipPosts("Atletico Madrid", "Real Madrid");

    const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
    expect(body.query).toBe("Atletico Madrid Real Madrid");
  });

  it("falls back to a week-wide search when the last-day search finds nothing — a late-day goal's post can be just outside a strict 24h window", async () => {
    const fetchSpy = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ items: [] }) })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ items: [{ id: "x", title: "t", author: null, permalink: "/p", createdAt: "2026-01-01T00:00:00.000Z" }] }),
      });
    vi.stubGlobal("fetch", fetchSpy);

    const result = await searchGoalClipPosts("Arsenal", "Chelsea");

    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(JSON.parse(fetchSpy.mock.calls[0][1].body).time).toBe("day");
    expect(JSON.parse(fetchSpy.mock.calls[1][1].body).time).toBe("week");
    expect(result).toHaveLength(1);
  });
});

describe("searchGoalClipPostsWide", () => {
  const original = process.env.FETCHLAYER_API_KEY;

  beforeEach(() => {
    process.env.FETCHLAYER_API_KEY = "ss-test-key";
  });

  afterEach(() => {
    if (original === undefined) delete process.env.FETCHLAYER_API_KEY;
    else process.env.FETCHLAYER_API_KEY = original;
    vi.unstubAllGlobals();
  });

  // Confirmed live against a real 17-day-old match (Man City 1-0 Coventry,
  // 2026-09-05): searchGoalClipPosts's sort=new found nothing at any time
  // window — "new" always returns the *newest* matching posts, and a
  // couple of weeks of unrelated chatter mentioning either team name is
  // plenty to crowd an older Goal Clip post out of a 30-item page
  // entirely. sort=relevance found the real post immediately.
  it("searches by relevance, not recency — the whole reason this function exists", async () => {
    const fetchSpy = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ items: [{ id: "x", title: "t", author: null, permalink: "/p", createdAt: "2026-01-01T00:00:00.000Z" }] }) });
    vi.stubGlobal("fetch", fetchSpy);

    await searchGoalClipPostsWide("Manchester City", "Coventry City");

    const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
    expect(body.sort).toBe("relevance");
    expect(body.time).toBe("month");
    expect(body.query).toBe("Manchester City Coventry City");
  });

  it("falls back to an all-time search when the last month finds nothing", async () => {
    const fetchSpy = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ items: [] }) })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ items: [{ id: "x", title: "t", author: null, permalink: "/p", createdAt: "2026-01-01T00:00:00.000Z" }] }),
      });
    vi.stubGlobal("fetch", fetchSpy);

    const result = await searchGoalClipPostsWide("Arsenal", "Chelsea");

    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(JSON.parse(fetchSpy.mock.calls[0][1].body).time).toBe("month");
    expect(JSON.parse(fetchSpy.mock.calls[1][1].body).time).toBe("all");
    expect(JSON.parse(fetchSpy.mock.calls[1][1].body).sort).toBe("relevance");
    expect(result).toHaveLength(1);
  });
});
