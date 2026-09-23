import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveClip } from "@/lib/reddit/resolve-clip";

describe("resolveClip", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("resolves a streamff.pro link via its known cdn.hostedhost.top pattern", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, url: "https://streamff.pro/v/0072d881", text: async () => "<html></html>" })
    );
    const result = await resolveClip("https://streamff.pro/v/0072d881");
    expect(result).toEqual({ videoUrl: "https://cdn.hostedhost.top/0072d881.mp4", posterUrl: null });
  });

  it("resolves a streamin.link watch page via its og:video meta tag (the generic path)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        url: "https://streamin.link/v/ab12",
        text: async () => `
          <meta property="og:video:secure_url" content="https://c-cdn.streamin.top/uploads/ab12.mp4" />
        `,
      })
    );
    const result = await resolveClip("https://streamin.link/v/ab12");
    expect(result?.videoUrl).toBe("https://c-cdn.streamin.top/uploads/ab12.mp4");
  });

  // Real bug, confirmed live: streama.in's watch page has no og:video tag
  // at all, and — the actual trap — a naive "find any .mp4 in the HTML"
  // search matches a completely different, unrelated clip from a "you
  // might also like" sidebar card elsewhere on the same page. The real
  // player only exists in a nested iframe at /embed/{id}, with a
  // `<video data-link="...">` attribute holding the actual file.
  it("resolves a streama.in link via its nested /embed/{id} iframe, not a sidebar mp4 on the outer page", async () => {
    const outerHtml = `
      <meta property="og:image" content="https://streamain.com/thumbnails/right_thumb.jpg">
      <div class="card-v">
        <a data-preview-src="https://media.sportits.com/guests/WRONG_SIDEBAR_CLIP.mp4"></a>
      </div>
      <iframe src="https://streamain.com/embed/tOFgw2KzDyBhCQi"></iframe>
    `;
    const embedHtml = `
      <video data-link="https://media.sportits.com/guests/right_clip.mp4"></video>
    `;
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, url: "https://streamain.com/en/tOFgw2KzDyBhCQi/watch", text: async () => outerHtml })
      .mockResolvedValueOnce({ ok: true, text: async () => embedHtml });
    vi.stubGlobal("fetch", fetchMock);

    const result = await resolveClip("https://streama.in/tOFgw2KzDyBhCQi/watch");

    expect(result?.videoUrl).toBe("https://media.sportits.com/guests/right_clip.mp4");
    expect(result?.videoUrl).not.toContain("WRONG_SIDEBAR_CLIP");
    expect(result?.posterUrl).toBe("https://streamain.com/thumbnails/right_thumb.jpg");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1][0]).toBe("https://streamain.com/embed/tOFgw2KzDyBhCQi");
  });

  it("returns null when the mirror host is unreachable", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network down")));
    const result = await resolveClip("https://streamin.link/v/dead");
    expect(result).toBeNull();
  });
});
