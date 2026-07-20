/**
 * @syncforge/server
 *
 * The imperative shell. All the messy, stateful, I/O-bound work lives here:
 * Socket.IO handlers, Postgres, the OpenAI client, process lifecycle.
 *
 * The shell should stay boring. It receives bytes, calls into core, and sends
 * bytes back. When you find yourself writing an interesting algorithm in this
 * package, that is a signal it belongs in core instead -- where it can be
 * tested without a running server.
 *
 * HTTP framework is deliberately undecided at Phase 1; that call belongs to
 * Phase 7, when Socket.IO gets attached to an http.Server.
 */

import { CORE_PACKAGE } from "@syncforge/core";

console.log(`syncforge server skeleton -- core linked: ${CORE_PACKAGE}`);
