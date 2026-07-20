/**
 * The Socket.IO wiring -- the boring shell.
 *
 * Every handler here is three lines: decode the event, call the registry, emit
 * what it returns. If a handler ever grows an interesting branch, that branch
 * belongs in rooms.ts (or core), where it can be tested without a socket.
 *
 * `createSyncForgeServer` builds the server but does NOT listen -- it returns
 * the http.Server and io so the entrypoint can `listen` and a test can bind an
 * ephemeral port. Separating "construct" from "run" is what makes the wiring
 * itself testable rather than a global side effect.
 */

import { createServer, type Server as HttpServer } from "node:http";

import { Server } from "socket.io";

import type {
  JoinRoomMessage,
  OpAckMessage,
  OpBroadcastMessage,
  OpRejectMessage,
  RoomSnapshotMessage,
  SubmitOpMessage,
} from "@syncforge/shared";

import { RoomRegistry } from "./rooms.js";

/**
 * The socket's event maps, typed from the shared contract. Because these
 * parameterize `Server`, an `emit` with the wrong payload shape -- or an
 * `on` for an event the protocol never defined -- is a compile error. The wire
 * protocol and the socket cannot drift apart.
 */
export interface ClientToServerEvents {
  "room:join": (message: JoinRoomMessage) => void;
  "op:submit": (message: SubmitOpMessage) => void;
}

export interface ServerToClientEvents {
  "room:snapshot": (message: RoomSnapshotMessage) => void;
  "op:broadcast": (message: OpBroadcastMessage) => void;
  "op:ack": (message: OpAckMessage) => void;
  "op:reject": (message: OpRejectMessage) => void;
}

export type SyncForgeIo = Server<ClientToServerEvents, ServerToClientEvents>;

export interface SyncForgeServer {
  readonly httpServer: HttpServer;
  readonly io: SyncForgeIo;
}

export function createSyncForgeServer(): SyncForgeServer {
  const httpServer = createServer();
  const io: SyncForgeIo = new Server(httpServer, {
    // Dev-open CORS: the client is served from a different origin (Vite) than
    // the socket. Locked down when a real deployment origin exists.
    cors: { origin: "*" },
  });

  const rooms = new RoomRegistry();

  io.on("connection", (socket) => {
    // Socket.IO's per-connection id is our ClientId for this session.
    const clientId = socket.id;

    socket.on("room:join", (message) => {
      const snapshot = rooms.join(message.roomId, clientId);
      // socket.io's own room, used for fan-out below. Distinct from the
      // registry's member set, which exists to populate the snapshot.
      void socket.join(message.roomId);
      socket.emit("room:snapshot", snapshot);
    });

    socket.on("op:submit", (message) => {
      const outcome = rooms.submit(clientId, message);
      if (outcome.kind === "accepted") {
        // ack to the author, broadcast to everyone else in the room. `.to(room)`
        // from a socket excludes that socket, which is exactly the "everyone but
        // me" audience an author's own edit needs.
        socket.emit("op:ack", outcome.ack);
        socket.to(message.roomId).emit("op:broadcast", outcome.broadcast);
      } else {
        socket.emit("op:reject", outcome.reject);
      }
    });

    socket.on("disconnect", () => {
      rooms.leave(clientId);
    });
  });

  return { httpServer, io };
}
