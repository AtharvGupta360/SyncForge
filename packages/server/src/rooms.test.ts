/**
 * Unit tests for the room registry. No sockets: the registry returns messages
 * as data, so its every branch -- create-on-join, accept, all three rejects --
 * is checked at machine speed. This is the payoff of keeping the socket layer
 * out of the logic.
 */

import { describe, expect, it } from "vitest";

import { RoomRegistry } from "./rooms.js";
import type { SubmitOpMessage } from "@syncforge/shared";

function submitInsert(
  roomId: string,
  position: number,
  text: string,
  baseVersion: number,
  id = "op-1",
): SubmitOpMessage {
  return {
    kind: "op:submit",
    roomId,
    id,
    op: { type: "insert", position, text },
    baseVersion,
  };
}

describe("RoomRegistry.join", () => {
  it("creates an empty room on first join and returns its snapshot", () => {
    const reg = new RoomRegistry();
    const snapshot = reg.join("room-1", "alice");
    expect(snapshot).toEqual({
      kind: "room:snapshot",
      roomId: "room-1",
      content: "",
      version: 0,
      members: ["alice"],
    });
  });

  it("lists existing members to a later joiner", () => {
    const reg = new RoomRegistry();
    reg.join("room-1", "alice");
    const snapshot = reg.join("room-1", "bob");
    expect(snapshot.members).toEqual(["alice", "bob"]);
  });
});

describe("RoomRegistry.submit", () => {
  it("accepts a valid op and yields ack + broadcast", () => {
    const reg = new RoomRegistry();
    reg.join("room-1", "alice");

    const outcome = reg.submit("alice", submitInsert("room-1", 0, "hi", 0));
    expect(outcome).toEqual({
      kind: "accepted",
      ack: { kind: "op:ack", id: "op-1", sequence: 1 },
      broadcast: {
        kind: "op:broadcast",
        roomId: "room-1",
        op: { type: "insert", position: 0, text: "hi" },
        authorId: "alice",
        sequence: 1,
      },
    });
  });

  it("advances the stored version across sequential submits", () => {
    const reg = new RoomRegistry();
    reg.join("room-1", "alice");

    const first = reg.submit("alice", submitInsert("room-1", 0, "ab", 0));
    expect(first).toMatchObject({ kind: "accepted", ack: { sequence: 1 } });

    // Next op is written against the version the first established.
    const second = reg.submit("alice", submitInsert("room-1", 2, "cd", 1, "op-2"));
    expect(second).toMatchObject({ kind: "accepted", ack: { sequence: 2 } });
  });

  it("rejects a submission to a room that was never joined", () => {
    const reg = new RoomRegistry();
    const outcome = reg.submit("alice", submitInsert("ghost", 0, "x", 0));
    expect(outcome).toEqual({
      kind: "rejected",
      reject: { kind: "op:reject", id: "op-1", reason: "unknown-room" },
    });
  });

  it("rejects an out-of-bounds op as invalid-op", () => {
    const reg = new RoomRegistry();
    reg.join("room-1", "alice");
    const outcome = reg.submit("alice", {
      kind: "op:submit",
      roomId: "room-1",
      id: "op-9",
      op: { type: "delete", position: 5, length: 3 },
      baseVersion: 0,
    });
    expect(outcome).toMatchObject({
      kind: "rejected",
      reject: { reason: "invalid-op" },
    });
  });
});
