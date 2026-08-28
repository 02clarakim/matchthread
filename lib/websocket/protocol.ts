import type { RealtimeMessage } from "../redis/pubsub";

/** Messages a browser client sends to the WebSocket gateway. */
export type ClientMessage =
  | { type: "auth"; token: string }
  | { type: "subscribe_match"; matchId: string }
  | { type: "unsubscribe_match"; matchId: string }
  /** Subscribe to events for the authenticated user's favorite teams. */
  | { type: "subscribe_favorites" }
  | { type: "unsubscribe_favorites" }
  | { type: "ping" };

/** Messages the gateway sends to a browser client. */
export type ServerMessage =
  | { type: "connected" }
  | { type: "authenticated"; userId: string }
  | { type: "auth_error"; message: string }
  | { type: "subscribed"; channel: string }
  | { type: "unsubscribed"; channel: string }
  | { type: "error"; message: string }
  | { type: "pong" }
  | RealtimeMessage;

export function isClientMessage(value: unknown): value is ClientMessage {
  if (typeof value !== "object" || value === null) return false;
  const type = (value as { type?: unknown }).type;
  return (
    type === "auth" ||
    type === "subscribe_match" ||
    type === "unsubscribe_match" ||
    type === "subscribe_favorites" ||
    type === "unsubscribe_favorites" ||
    type === "ping"
  );
}
