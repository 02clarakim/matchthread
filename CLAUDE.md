@AGENTS.md

## Project Context

MatchPulse is a real-time football (soccer) social aggregator: live match
events, generated commentary, and community reactions in one feed. Built
end-to-end — Next.js, PostgreSQL/Prisma, Redis pub/sub, a standalone
WebSocket gateway, and background workers for ingestion/matching. See
README.md for full architecture, data flow, and reliability notes.

**What's built and verified**: the full pipeline — seed data, an event
simulator, real-time WebSocket updates, idempotent ingestion, a three-stage
event-to-social matching engine, Auth.js login/favorites, and a
live-ticking match clock — works end-to-end and has been verified against
a real live match.

**The core product goal, not yet fully solved**: pairing live score/event
updates with an *embedded* video clip of the goal, not just a link out —
that's the differentiator from a plain live-score app. Automatically
sourcing a legitimate, embeddable clip for each goal in real time is still
an open problem: it needs a data source whose own terms actually permit
this kind of automated access and embedding, which has proven harder to
line up than the rest of the build. Manual/simulated event triggering
(`npm run simulate-event`) is a fully working fallback demo path in the
meantime — it drives the exact same real pipeline, just triggered by hand
instead of an automated detector.

