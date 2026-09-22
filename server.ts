import "dotenv/config";
import { createServer } from "node:http";
import next from "next";
import { logger } from "./lib/logger";
import { attachWebSocketGateway } from "./workers/ws-server";
import { startPolling as startEspnPolling } from "./workers/espn-live-poller";
import { startPolling as startRedditPolling } from "./workers/reddit-clip-poller";

/**
 * Single-process deploy: the Next.js app, the WebSocket gateway, and both
 * background pollers all run in one Node process on one port, instead of
 * 4 separate services + Redis for pub/sub between them. See DEPLOY.md for
 * the cost reasoning — this is what gets a Render deploy down to one
 * $0-7/mo web service instead of ~$45/mo across 6 resources.
 *
 * Nothing about the individual pieces changed to make this possible: the
 * WebSocket gateway (workers/ws-server.ts) already separated "the gateway
 * logic" from "how it's hosted" via attachWebSocketGateway(), and
 * lib/redis/pubsub.ts + lib/redis/cache.ts already fall back to in-process
 * alternatives when REDIS_URL isn't set — so a merged deploy is just
 * REDIS_URL being unset plus this file wiring the three pieces onto one
 * HTTP server. Each still runs standalone too (`npm run ws-server`,
 * `npm run worker:espn-live-poller`, `npm run worker:reddit-clip-poller`)
 * for a multi-process deploy or local debugging, if that's ever preferred
 * over this.
 */

const dev = process.env.NODE_ENV !== "production";
const port = Number(process.env.PORT ?? 3000);

const app = next({ dev });
const handle = app.getRequestHandler();

app.prepare().then(() => {
  const httpServer = createServer((req, res) => handle(req, res));

  attachWebSocketGateway(httpServer);

  httpServer.listen(port, () => {
    logger.info("merged_server_started", { port, dev });
  });

  // Fire-and-forget: each poller's own loop already wraps every tick in
  // try/catch (see espn-live-poller.ts / reddit-clip-poller.ts), so a
  // transient failure inside one tick doesn't reach here. This only fires
  // on a genuinely unrecoverable startup error — log it, but don't let it
  // take the web server down with it.
  startEspnPolling().catch((err) => logger.error("espn_poller_crashed", { error: String(err) }));
  startRedditPolling().catch((err) => logger.error("reddit_poller_crashed", { error: String(err) }));
});
