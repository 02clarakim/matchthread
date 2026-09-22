/**
 * The one account "Try the demo" (components/auth/demo-login-button.tsx)
 * signs into. Real credentials against the real Credentials provider, not
 * a mock — see auth.ts. Client-safe (no Prisma import) so the login button
 * can use these directly; the DB-touching reset lives in
 * lib/demo-account-server.ts, server-only.
 */
export const DEMO_EMAIL = "demo@example.com";
export const DEMO_PASSWORD = "password123";

/**
 * This single account is shared by every visitor who clicks "Try the
 * demo" — a curated set of favorites makes everyone's first impression the
 * same, and resetting it on every login (see auth.ts's authorize(), which
 * calls resetDemoFavorites in lib/demo-account-server.ts) means one
 * visitor's follow/unfollow clicks during their session never carry over
 * into the next person's. Team *names*, resolved at reset time, rather
 * than hardcoded ids — ids are assigned at seed/ingest time and differ per
 * environment.
 */
export const DEMO_DEFAULT_TEAM_NAMES = [
  "Liverpool",
  "Barcelona",
  "Bayern Munich",
  "Atletico Madrid",
  "Manchester United",
  "Manchester City",
];
