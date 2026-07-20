/**
 * @syncforge/server -- entrypoint.
 *
 * The imperative shell. All the messy, stateful, I/O-bound work lives in this
 * package: WebSocket handlers (server.ts), and later Postgres and the OpenAI
 * client. This file's only job is process lifecycle -- build the server and
 * start listening. Everything interesting is one call away in server.ts and
 * rooms.ts, and everything hard is another call away in core.
 *
 * Phase 1 left the HTTP framework undecided; Phase 7 decided it: Socket.IO on a
 * bare http.Server (see server.ts for the trade vs raw WebSockets).
 */

import { createSyncForgeServer } from "./server.js";

const PORT = Number(process.env.PORT ?? 3001);

const { httpServer } = createSyncForgeServer();

httpServer.listen(PORT, () => {
  console.log(`syncforge server listening on :${PORT}`);
});
