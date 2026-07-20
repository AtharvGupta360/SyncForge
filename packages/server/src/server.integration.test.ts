/**
 * End-to-end transport test: a real Socket.IO server and two real clients over
 * loopback TCP. The registry unit tests already prove the logic; this proves the
 * *wiring* -- that an edit from one client actually reaches the other, ack'd to
 * the author and broadcast to the peer, with the server's sequence attached.
 *
 * This is the first test where SyncForge does the thing it exists to do: relay
 * an edit between two clients.
 */

import type { AddressInfo } from "node:net";

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { io as connect, type Socket } from "socket.io-client";

import { createSyncForgeServer, type SyncForgeServer } from "./server.js";
import type {
  OpAckMessage,
  OpBroadcastMessage,
  OpRejectMessage,
  RoomSnapshotMessage,
} from "@syncforge/shared";

/** Resolve with the next payload of `event`, or reject if it takes too long. */
function once<T>(socket: Socket, event: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`timed out waiting for "${event}"`)),
      2000,
    );
    socket.once(event, (payload: T) => {
      clearTimeout(timer);
      resolve(payload);
    });
  });
}

let server: SyncForgeServer;
let url: string;

beforeAll(async () => {
  server = createSyncForgeServer();
  await new Promise<void>((resolve) => server.httpServer.listen(0, resolve));
  const { port } = server.httpServer.address() as AddressInfo;
  url = `http://localhost:${port}`;
});

afterAll(async () => {
  server.io.close();
  await new Promise<void>((resolve) => server.httpServer.close(() => resolve()));
});

function newClient(): Socket {
  return connect(url, { transports: ["websocket"], forceNew: true });
}

describe("transport", () => {
  it("relays an accepted edit: ack to author, broadcast to peer", async () => {
    const alice = newClient();
    const bob = newClient();

    try {
      await Promise.all([once(alice, "connect"), once(bob, "connect")]);

      // Both join; awaiting each snapshot guarantees the server has run
      // socket.join before we submit, so bob is a broadcast recipient.
      alice.emit("room:join", { kind: "room:join", roomId: "r" });
      bob.emit("room:join", { kind: "room:join", roomId: "r" });
      await Promise.all([
        once<RoomSnapshotMessage>(alice, "room:snapshot"),
        once<RoomSnapshotMessage>(bob, "room:snapshot"),
      ]);

      const ackP = once<OpAckMessage>(alice, "op:ack");
      const broadcastP = once<OpBroadcastMessage>(bob, "op:broadcast");

      alice.emit("op:submit", {
        kind: "op:submit",
        roomId: "r",
        id: "op-1",
        op: { type: "insert", position: 0, text: "hello" },
        baseVersion: 0,
      });

      const [ack, broadcast] = await Promise.all([ackP, broadcastP]);

      expect(ack).toEqual({ kind: "op:ack", id: "op-1", sequence: 1 });
      expect(broadcast).toEqual({
        kind: "op:broadcast",
        roomId: "r",
        op: { type: "insert", position: 0, text: "hello" },
        authorId: alice.id,
        sequence: 1,
      });
    } finally {
      alice.disconnect();
      bob.disconnect();
    }
  });

  it("rejects a stale submission back to the author only", async () => {
    const alice = newClient();
    try {
      await once(alice, "connect");
      alice.emit("room:join", { kind: "room:join", roomId: "r2" });
      await once<RoomSnapshotMessage>(alice, "room:snapshot");

      // First edit moves the room to version 1.
      alice.emit("op:submit", {
        kind: "op:submit",
        roomId: "r2",
        id: "op-1",
        op: { type: "insert", position: 0, text: "ab" },
        baseVersion: 0,
      });
      await once<OpAckMessage>(alice, "op:ack");

      // Second edit still claims version 0 -> stale.
      const rejectP = once<OpRejectMessage>(alice, "op:reject");
      alice.emit("op:submit", {
        kind: "op:submit",
        roomId: "r2",
        id: "op-2",
        op: { type: "insert", position: 2, text: "c" },
        baseVersion: 0,
      });

      expect(await rejectP).toEqual({
        kind: "op:reject",
        id: "op-2",
        reason: "stale-version",
      });
    } finally {
      alice.disconnect();
    }
  });
});
