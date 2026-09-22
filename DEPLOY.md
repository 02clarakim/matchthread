# Deploying MatchThread

MatchThread is 4 separate long-running processes, not just a Next.js app:
the web app, a standalone WebSocket gateway, and two background pollers —
plus Postgres and Redis. Vercel can't run the pollers or a persistent
WebSocket server (it's serverless); **Render** is the target this is built
for (`workers/ws-server.ts` already binds to `$PORT` for it).

`render.yaml` in the repo root defines all 5 resources (2 web services, 2
background workers, 1 Postgres, 1 Redis) as a Render Blueprint, so you
don't click through the dashboard 5 times by hand.

## 1. Accounts and secrets (only you can do this part)

- A **Render** account with a payment method attached (the free tier
  spins services down when idle — fine for a demo you check occasionally,
  not for pollers that need to run continuously during match windows).
- An **OpenAI API key** — powers the LLM commentary; everything falls back
  to a generated template if this is unset, so it's optional but the app
  looks much better with it. Set a spend cap on the OpenAI dashboard.
- A **FetchLayer** key + top-up (`fetchlayer.dev`) — powers the automated
  Reddit clip search. Optional in the same sense: the worker logs
  "unconfigured" and does nothing if it's unset.
- Generate an **AUTH_SECRET**: run `npx auth secret` locally and save the
  output — you'll paste the *same* value into two different services
  below (this is the one genuinely easy-to-miss step; see step 4).

## 2. Deploy via the Blueprint

1. Push this repo to GitHub if it isn't already (it is).
2. Render dashboard → **New** → **Blueprint** → connect the
   `02clarakim/matchthread` repo → Render parses `render.yaml` and
   proposes: `matchthread-db` (Postgres), `matchthread-redis`,
   `matchthread-web`, `matchthread-ws`, `matchthread-espn-poller`,
   `matchthread-reddit-poller`.
3. Render will prompt for every `sync: false` env var it finds. You can
   leave `NEXTAUTH_URL` and `NEXT_PUBLIC_WS_URL` blank for now — the
   Blueprint can't know the URLs Render is about to assign until the
   services actually exist. Fill in `OPENAI_API_KEY` and
   `FETCHLAYER_API_KEY` now if you have them.
4. Click **Apply**. Render provisions all 5 resources and starts building.

## 3. Wire up the two circular-dependency env vars

These can't be known until the services exist, so fix them right after
the first deploy:

1. Open `matchthread-ws`'s dashboard page, copy its public URL (something
   like `https://matchthread-ws.onrender.com`).
2. On `matchthread-web`, set `NEXT_PUBLIC_WS_URL` to that same URL with
   `wss://` instead of `https://`, and set `NEXTAUTH_URL` to
   `matchthread-web`'s own public URL. **`NEXT_PUBLIC_*` vars are inlined
   at build time**, not read at runtime — after setting this, trigger a
   manual redeploy of `matchthread-web` (not just a restart) or it'll
   still be pointing at `ws://localhost:4001`.
3. **`AUTH_SECRET` must be set to the exact same value on both
   `matchthread-web` and `matchthread-ws`.** The WS gateway runs outside
   Next.js's request pipeline and can't read the session cookie directly
   — it verifies the same signed JWT itself (`lib/websocket/token.ts`),
   using this secret. If they don't match, every WebSocket connection
   gets silently rejected as unauthenticated and the app will look like
   live updates just don't work, with no obvious error.

## 4. Database: migrate, then decide what data to load

Run these with `DATABASE_URL` pointed at the **production** database
(copy the external connection string from `matchthread-db`'s Render page
— Render also lets you run one-off jobs against a service's own env, which
avoids exposing the prod URL to your shell at all, if you'd rather do it
that way):

```bash
DATABASE_URL="<production connection string>" npm run db:migrate:deploy
```

This runs `prisma migrate deploy` — **never** `prisma migrate dev`
against production; `dev` can prompt to reset the database.

Then decide what the database should actually contain on launch:

- `npm run seed` — the demo dataset (demo@example.com, a few hand-built
  matches with real-shaped events). Good for the account the "Try the
  demo" button signs into, but not real current fixtures.
- `npm run backfill -- --leagues=eng.1,esp.1,ger.1 --clips` — pulls the
  real current season from ESPN and attaches any Reddit clips already
  covered by the static snapshots in `data/reddit-clips/`. This is what
  actually makes the app look "live" rather than seeded.
- Realistically: run both. Seed first (for the demo account and its
  favorites), then backfill (for real match data). Both are idempotent —
  safe to re-run.

## 5. Verify it's actually working, not just deployed

A green build on Render doesn't mean the product works — check each
piece directly:

- [ ] Landing page loads with a real match (not the empty state)
- [ ] Sign in with the demo account, confirm favorites show up on
      `/dashboard`
- [ ] Open a match page, confirm the live indicator connects (open
      browser devtools → Network → WS, confirm a connection to
      `matchthread-ws` upgrades and stays open, not immediately closing)
- [ ] Check `matchthread-espn-poller`'s logs on Render — confirm it logs
      `espn_live_poller_started` and (during an actual match window) is
      polling, not idling with an error
- [ ] Check `matchthread-reddit-poller`'s logs — confirm
      `reddit_clip_poller_started` with `configured: true` (if
      `FETCHLAYER_API_KEY` is set) — `configured: false` means the key
      didn't make it into the environment
- [ ] Trigger `npm run simulate-event` against production once (or just
      wait for a real live match) to confirm the whole pipeline — ESPN
      event → commentary → WebSocket push → browser update — actually
      fires end-to-end in production, not just locally

## 6. Not blocking launch, worth doing soon after

- **Custom domain**: Render → `matchthread-web` → Settings → Custom
  Domains, then a CNAME at your registrar. Update `NEXTAUTH_URL` and
  redeploy once it's live.
- **Database backups**: Render Postgres takes automatic daily backups on
  paid plans — confirm the plan you're on actually includes this.
- **Registration has no rate limiting** (`app/api/auth/register`) — low
  risk for a portfolio project with no real user base yet, but worth a
  simple IP-based limit before sharing the link widely.
- **Cost monitoring**: OpenAI and FetchLayer both bill per-use with no
  built-in cap here — set spend alerts on both dashboards so a stuck
  retry loop can't run up a bill unnoticed.
