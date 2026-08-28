import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { mintWsToken } from "@/lib/websocket/token";

/**
 * Mints a short-lived token the browser presents to the standalone
 * WebSocket gateway (workers/ws-server.ts) to authenticate its connection.
 * The gateway runs outside Next's request pipeline on its own port, so it
 * can't read the session cookie directly — this route is the trusted
 * bridge, using the session Next.js already verified.
 */
export async function POST() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const token = await mintWsToken(session.user.id);
  return NextResponse.json({ token });
}
