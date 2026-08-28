"use client";

import { useEffect, useRef } from "react";
import type { RealtimeMessage } from "@/lib/redis/pubsub";
import type { ClientMessage, ServerMessage } from "@/lib/websocket/protocol";

interface UseRealtimeOptions {
  /** Subscribe to a specific match's events (works unauthenticated). */
  matchId?: string;
  /** Subscribe to the signed-in user's favorite-team feed (requires auth). */
  favorites?: boolean;
  onMessage: (message: RealtimeMessage) => void;
}

const REALTIME_TYPES = new Set(["match_event", "commentary_update", "highlight_update", "match_update"]);

function isRealtimeMessage(message: ServerMessage): message is RealtimeMessage {
  return REALTIME_TYPES.has(message.type);
}

/**
 * Connects to the standalone WebSocket gateway (workers/ws-server.ts) and
 * keeps a single connection alive for the lifetime of the calling
 * component, with exponential-backoff reconnection. Re-sends the desired
 * subscriptions on every (re)connect — the gateway keeps no state across
 * connections, so that's the client's job.
 */
export function useRealtime({ matchId, favorites, onMessage }: UseRealtimeOptions) {
  const onMessageRef = useRef(onMessage);
  useEffect(() => {
    onMessageRef.current = onMessage;
  }, [onMessage]);

  useEffect(() => {
    const url = process.env.NEXT_PUBLIC_WS_URL;
    if (!url) return;

    let ws: WebSocket | null = null;
    let reconnectAttempt = 0;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let cancelled = false;

    function send(message: ClientMessage) {
      if (ws?.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(message));
      }
    }

    async function authenticate() {
      try {
        const res = await fetch("/api/ws-token", { method: "POST" });
        if (!res.ok) return;
        const { token } = (await res.json()) as { token: string };
        send({ type: "auth", token });
      } catch {
        // no session / network hiccup — favorites subscription just won't apply
      }
    }

    async function connect() {
      if (cancelled) return;
      ws = new WebSocket(url!);

      ws.onopen = async () => {
        reconnectAttempt = 0;
        if (favorites) await authenticate();
        if (matchId) send({ type: "subscribe_match", matchId });
        if (favorites) send({ type: "subscribe_favorites" });
      };

      ws.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data) as ServerMessage;
          if (isRealtimeMessage(message)) onMessageRef.current(message);
        } catch {
          // ignore malformed frames from the server
        }
      };

      ws.onclose = () => {
        if (cancelled) return;
        reconnectAttempt += 1;
        const delay = Math.min(1000 * 2 ** reconnectAttempt, 15000);
        reconnectTimer = setTimeout(connect, delay);
      };

      ws.onerror = () => {
        ws?.close();
      };
    }

    connect();

    return () => {
      cancelled = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      ws?.close();
    };
  }, [matchId, favorites]);
}
