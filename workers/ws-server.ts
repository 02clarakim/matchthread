import "dotenv/config";
import { createServer, type Server as HttpServer } from "node:http";
import { WebSocketServer, WebSocket } from "ws";
import { prisma } from "../lib/db/prisma";
import { logger } from "../lib/logger";
import { subscribeToRealtimeMessages, type RealtimeMessage } from "../lib/redis/pubsub";
import { verifyWsToken } from "../lib/websocket/token";
import { isClientMessage, type ServerMessage } from "../lib/websocket/protocol";

// Render (and most PaaS web-service hosts) assign the listening port via
// PORT, not a custom var — check it first so this binds correctly there,
// while WS_PORT keeps working for local dev (see .env.example). Only used
// in standalone mode (see startStandalone below) — the merged single-
// process deploy (server.ts) already owns a port via Next.js.
const PORT = Number(process.env.PORT ?? process.env.WS_PORT ?? 4001);

interface ClientState {
  userId: string | null;
  matchIds: Set<string>;
  favoritesSubscribed: boolean;
  favoriteTeamIds: Set<string>;
}

const clients = new Map<WebSocket, ClientState>();

function send(ws: WebSocket, message: ServerMessage) {
  if (ws.readyState !== WebSocket.OPEN) return;
  ws.send(JSON.stringify(message));
}

async function loadFavoriteTeamIds(userId: string): Promise<Set<string>> {
  const favorites = await prisma.userFavoriteTeam.findMany({
    where: { userId },
    select: { teamId: true },
  });
  return new Set(favorites.map((f) => f.teamId));
}

/**
 * Attaches the WebSocket gateway to an existing HTTP server, sharing its
 * port — the `ws` library hooks the server's `upgrade` event specifically,
 * so normal HTTP requests (Next.js's, in the merged deploy — see
 * server.ts) are untouched. Used by both the standalone entrypoint below
 * and the merged single-process server, so there's exactly one
 * implementation of the actual gateway logic either way.
 */
export function attachWebSocketGateway(server: HttpServer): WebSocketServer {
  const wss = new WebSocketServer({ server });

  wss.on("connection", (ws) => {
    const state: ClientState = {
      userId: null,
      matchIds: new Set(),
      favoritesSubscribed: false,
      favoriteTeamIds: new Set(),
    };
    clients.set(ws, state);
    logger.info("websocket_connected", { totalClients: clients.size });
    send(ws, { type: "connected" });

    ws.on("message", async (raw) => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw.toString());
      } catch {
        send(ws, { type: "error", message: "Malformed message: not valid JSON" });
        return;
      }

      if (!isClientMessage(parsed)) {
        send(ws, { type: "error", message: "Unknown message type" });
        return;
      }

      switch (parsed.type) {
        case "auth": {
          const verified = await verifyWsToken(parsed.token);
          if (!verified) {
            send(ws, { type: "auth_error", message: "Invalid or expired token" });
            return;
          }
          state.userId = verified.userId;
          send(ws, { type: "authenticated", userId: verified.userId });
          break;
        }

        case "subscribe_match": {
          state.matchIds.add(parsed.matchId);
          send(ws, { type: "subscribed", channel: `match:${parsed.matchId}` });
          break;
        }

        case "unsubscribe_match": {
          state.matchIds.delete(parsed.matchId);
          send(ws, { type: "unsubscribed", channel: `match:${parsed.matchId}` });
          break;
        }

        case "subscribe_favorites": {
          if (!state.userId) {
            send(ws, { type: "auth_error", message: "Must authenticate before subscribing to favorites" });
            return;
          }
          try {
            state.favoriteTeamIds = await loadFavoriteTeamIds(state.userId);
            state.favoritesSubscribed = true;
            send(ws, { type: "subscribed", channel: "favorites" });
          } catch (err) {
            logger.error("websocket_load_favorites_failed", { userId: state.userId, error: String(err) });
            send(ws, { type: "error", message: "Could not load favorite teams" });
          }
          break;
        }

        case "unsubscribe_favorites": {
          state.favoritesSubscribed = false;
          send(ws, { type: "unsubscribed", channel: "favorites" });
          break;
        }

        case "ping": {
          send(ws, { type: "pong" });
          break;
        }
      }
    });

    ws.on("close", () => {
      clients.delete(ws);
      logger.info("websocket_disconnected", { totalClients: clients.size });
    });

    ws.on("error", (err) => {
      logger.warn("websocket_client_error", { error: String(err) });
    });
  });

  subscribeToRealtimeMessages(broadcast);
  logger.info("websocket_gateway_attached", {});
  return wss;
}

function relevantTo(state: ClientState, message: RealtimeMessage): boolean {
  if (state.matchIds.has(message.matchId)) return true;
  if (state.favoritesSubscribed) {
    return message.teamIds.some((teamId) => state.favoriteTeamIds.has(teamId));
  }
  return false;
}

function broadcast(message: RealtimeMessage) {
  let delivered = 0;
  for (const [ws, state] of clients) {
    if (relevantTo(state, message)) {
      send(ws, message);
      delivered += 1;
    }
  }
  logger.info("websocket_broadcast", { type: message.type, matchId: message.matchId, delivered });
}

/**
 * Standalone entrypoint: `npm run ws-server` runs the gateway as its own
 * process on its own port — still supported for a multi-process deploy,
 * or if you'd rather run it separately locally. The merged single-process
 * deploy (server.ts, `npm run dev`/`npm start`) calls
 * attachWebSocketGateway() directly instead of this file at all.
 */
function startStandalone() {
  const server = createServer();
  attachWebSocketGateway(server);
  server.listen(PORT, () => logger.info("websocket_gateway_started", { port: PORT }));

  async function shutdown() {
    logger.info("websocket_gateway_shutting_down", {});
    await prisma.$disconnect();
    process.exit(0);
  }

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

if (require.main === module) {
  startStandalone();
}
