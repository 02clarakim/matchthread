import { SignJWT, jwtVerify } from "jose";

/**
 * Short-lived tokens used only to authenticate a browser's WebSocket
 * connection to the standalone gateway process (workers/ws-server.ts).
 *
 * The gateway runs on its own port outside of Next.js's request pipeline,
 * so it can't read the NextAuth session cookie directly. Instead, an
 * authenticated Next.js API route (`/api/ws-token`) mints one of these
 * using the session it already trusts, and the client presents it on
 * connect. Verified with the same AUTH_SECRET Auth.js uses, so no extra
 * secret to manage.
 */

const WS_TOKEN_TTL_SECONDS = 60;

function getSecretKey() {
  const secret = process.env.AUTH_SECRET;
  if (!secret) throw new Error("AUTH_SECRET is not set");
  return new TextEncoder().encode(secret);
}

export async function mintWsToken(userId: string): Promise<string> {
  return new SignJWT({ userId })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${WS_TOKEN_TTL_SECONDS}s`)
    .sign(getSecretKey());
}

export async function verifyWsToken(token: string): Promise<{ userId: string } | null> {
  try {
    const { payload } = await jwtVerify(token, getSecretKey());
    if (typeof payload.userId !== "string") return null;
    return { userId: payload.userId };
  } catch {
    return null;
  }
}
