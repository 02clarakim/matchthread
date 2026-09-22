# Deploying MatchThread

MatchThread is normally 4 separate long-running processes — the web app,
a standalone WebSocket gateway, and two background pollers — plus
Postgres and Redis. Run that way across managed Render services, it costs
roughly $45/mo. `server.ts` merges all 4 processes into one, and Postgres
moves to a free external host, bringing that down to **$0-7/mo**:

| Piece | Normally | Here |
|---|---|---|
| Web app + WebSocket gateway + 2 pollers | 4 Render services | 1 Render service (`server.ts`) |
| Redis (pub/sub between the 4) | Render Redis, ~$10/mo | not needed — same process now, an in-process event emitter replaces it (`lib/redis/pubsub.ts`) |
| Postgres | Render Postgres, ~$6+/mo | [Neon](https://neon.com) free tier — permanent, no expiry, fine for a low-traffic app |
| **Total** | **~$45/mo** | **$0/mo (free Render plan) or $7/mo (Starter, no idle spin-down)** |

`render.yaml` in the repo root defines the single service as a Render
Blueprint.

## Why this is safe, not a hack

Nothing about the individual pieces changed to make the merge possible —
it was already structured this way:

- `workers/ws-server.ts` already separates the gateway's *logic* from
  *how it's hosted*, via `attachWebSocketGateway(server)`. `server.ts`
  calls that directly on the same HTTP server Next.js uses; the
  standalone `npm run ws-server` entrypoint still works unchanged if you
  ever want a separate process again.
- `lib/redis/pubsub.ts` and `lib/redis/cache.ts` already fall back to an
  in-process implementation whenever `REDIS_URL` is unset — same
  interface either way, so nothing that calls them had to change.
- Local dev is **unaffected**: `npm run dev` is still plain `next dev`,
  `docker-compose.yml` still runs Postgres + Redis, and `REDIS_URL` stays
  set locally — so the familiar multi-process dev workflow (`npm run dev`
  + `npm run ws-server` + the two `npm run worker:*` commands in separate
  terminals) behaves exactly as before. The merge only applies to `npm
  start` (`server.ts`), which is what production actually runs.

**Trade-off worth knowing**: one process now means one crash surface —
each poller already wraps every tick in try/catch, but a truly
unrecoverable error in one theoretically shares a container with the web
app rather than an isolated service. Reasonable for a low-traffic
portfolio deploy; revisit if this ever needs to scale beyond that.

## 1. Accounts and secrets (only you can do this part)

- A **Render** account (no payment method needed for the free plan).
- A **Neon** account (`neon.com`) — free, no card required. Create a
  project, copy its connection string — that's your `DATABASE_URL`.
- An **OpenAI API key** (optional — LLM commentary falls back to a
  generated template without it). Set a spend cap on the OpenAI
  dashboard if you add one.
- A **FetchLayer** key + top-up (optional — the Reddit clip poller logs
  "unconfigured" and does nothing without it).
- Generate an **AUTH_SECRET**: run `npx auth secret` locally and save the
  output.

## 2. Deploy via the Blueprint

1. Push this repo to GitHub if it isn't already (it is).
2. Render dashboard → **New** → **Blueprint** → connect the
   `02clarakim/matchthread` repo → Render parses `render.yaml` and
   proposes one service, `matchthread`, on the **free** plan.
3. Render prompts for every `sync: false` env var. Paste in your Neon
   `DATABASE_URL` and `AUTH_SECRET` now; `OPENAI_API_KEY` /
   `FETCHLAYER_API_KEY` if you have them. Leave `NEXTAUTH_URL` and
   `NEXT_PUBLIC_WS_URL` blank for now (see step 3 below).
4. Click **Apply**. Render provisions the service and builds it.

## 3. Wire up the URL env vars (can't be known until step 2 finishes)

1. Copy `matchthread`'s assigned public URL from its Render dashboard
   page (e.g. `https://matchthread.onrender.com`).
2. Set `NEXTAUTH_URL` to that URL (`https://...`).
3. Set `NEXT_PUBLIC_WS_URL` to the *same* URL with `wss://` instead of
   `https://`. **This is inlined at build time, not read at runtime** —
   after setting it, trigger a manual redeploy (not just a restart), or
   the shipped bundle will still be pointing at `ws://localhost:4001`.

## 4. Database: migrate, then decide what data to load

Run these with `DATABASE_URL` pointed at your **Neon** connection string:

```bash
DATABASE_URL="<neon connection string>" npm run db:migrate:deploy
```

This runs `prisma migrate deploy` — **never** `prisma migrate dev`
against a real database; `dev` can prompt to reset it.

Then decide what the database should actually contain on launch:

- `npm run seed` — the demo dataset (`demo@example.com`, a few hand-built
  matches). Needed for the "Try the demo" button to have something to
  show and for its favorites to reset to a sane default on login.
- `npm run backfill -- --leagues=eng.1,esp.1,ger.1 --clips` — pulls the
  real current season from ESPN, attaches any Reddit clips already
  covered by the static snapshots in `data/reddit-clips/`. This is what
  makes the app look genuinely live rather than just seeded.
- Realistically: run both, in that order. Both are idempotent — safe to
  re-run.

## 5. Verify it's actually working, not just deployed

A green build doesn't mean the product works — check each piece:

- [ ] Landing page loads with a real match (not the empty state)
- [ ] Sign in with the demo account, confirm favorites show up on
      `/dashboard`
- [ ] Open a match page, confirm the live indicator connects (devtools →
      Network → WS, confirm the connection to your own domain upgrades
      and stays open — it's the same origin now, not a separate
      `matchthread-ws.onrender.com` host)
- [ ] Check the service's logs on Render for `merged_server_started`,
      `espn_live_poller_started`, and `reddit_clip_poller_started` — all
      three should appear (they're one process now, so one log stream)
- [ ] If `FETCHLAYER_API_KEY` is set, confirm the Reddit poller's log
      line shows `configured: true` — `false` means the key didn't reach
      the environment
- [ ] Trigger `npm run simulate-event` against production once (or wait
      for a real live match) to confirm the whole pipeline — ESPN event →
      commentary → WebSocket push → browser update — fires end-to-end,
      not just locally. Note: this specific script publishes over
      whatever `REDIS_URL` it's run with; since production has none, run
      it with the merged server itself already running and no separate
      `REDIS_URL` set, or expect it to only affect the database rather
      than push a live WS update on this deploy shape.

## 6. If you outgrow $0 or $7 later

Two independent, non-disruptive upgrades, in the order you'd likely need
them:

1. **Free → Starter plan ($7/mo)**: one field in `render.yaml`
   (`plan: free` → `plan: starter`) or a dropdown in the dashboard, then
   redeploy. No code changes — same single service, just no idle
   spin-down.
2. **Split back into multiple services**: if traffic or poller load ever
   genuinely need isolating again, set `REDIS_URL` (a Render Redis
   instance, or any managed Redis) and split `server.ts`'s three
   responsibilities back into the standalone entrypoints that still exist
   unchanged (`npm run ws-server`, `npm run worker:espn-live-poller`,
   `npm run worker:reddit-clip-poller`) as their own services. Nothing
   needs to be rebuilt to support this — the fallback-to-in-process
   design means it already supports both shapes.

## Not blocking launch, worth doing soon after

- **Custom domain**: Render → service → Settings → Custom Domains, then
  a CNAME at your registrar. Update `NEXTAUTH_URL` (and rebuild for
  `NEXT_PUBLIC_WS_URL`) once it's live.
- **Neon cold starts**: the free tier suspends compute after 5 minutes of
  inactivity and wakes on the next query (no data loss) — the first
  request after a quiet period will be slower. Fine for a portfolio demo;
  worth knowing if it ever feels like a hiccup.
- **Registration has no rate limiting** (`app/api/auth/register`) — low
  risk with no real user base yet, worth a simple IP-based limit before
  sharing the link widely.
- **Cost monitoring**: OpenAI and FetchLayer both bill per-use with no
  built-in cap here — set spend alerts on both dashboards.
