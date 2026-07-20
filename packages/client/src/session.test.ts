/**
 * Tests for the client session. Like the server registry, it returns messages
 * as data, so the whole send/ack/apply/resync state machine is checked with no
 * socket and no editor -- the payoff of keeping the brain out of the shell.
 */

import { describe, expect, it } from "vitest";

import { ClientSession } from "./session.js";
import type { Op } from "@syncforge/shared";

const insert = (position: number, text: string): Op => ({
  type: "insert",
  position,
  text,
});

function joined(roomId = "r"): ClientSession {
  const session = new ClientSession(roomId);
  session.onSnapshot({
    kind: "room:snapshot",
    roomId,
    content: "",
    version: 0,
    members: [],
  });
  return session;
}

describe("ClientSession.join / onSnapshot", () => {
  it("emits a join and adopts the snapshot", () => {
    const session = new ClientSession("r");
    expect(session.join()).toEqual([{ kind: "room:join", roomId: "r" }]);

    session.onSnapshot({
      kind: "room:snapshot",
      roomId: "r",
      content: "hello",
      version: 3,
      members: [],
    });
    expect(session.document).toBe("hello");
    expect(session.version).toBe(3);
  });
});

describe("ClientSession.localEdit -- optimistic send", () => {
  it("applies immediately and submits when idle", () => {
    const session = joined();
    const sent = session.localEdit("op-1", insert(0, "hi"));

    // Applied before any round-trip.
    expect(session.document).toBe("hi");
    expect(session.inFlight).toBe(true);
    expect(sent).toEqual([
      {
        kind: "op:submit",
        roomId: "r",
        id: "op-1",
        op: insert(0, "hi"),
        baseVersion: 0,
      },
    ]);
  });

  it("buffers a second edit instead of sending it", () => {
    const session = joined();
    session.localEdit("op-1", insert(0, "ab"));
    const sent = session.localEdit("op-2", insert(2, "cd"));

    expect(sent).toEqual([]); // nothing goes out while op-1 is in flight
    expect(session.document).toBe("abcd"); // but the user sees it
    expect(session.bufferedCount).toBe(1);
  });
});

describe("ClientSession.onAck", () => {
  it("clears the in-flight op and advances version", () => {
    const session = joined();
    session.localEdit("op-1", insert(0, "ab"));
    const sent = session.onAck({ kind: "op:ack", id: "op-1", sequence: 1 });

    expect(sent).toEqual([]);
    expect(session.inFlight).toBe(false);
    expect(session.version).toBe(1);
  });

  it("promotes the next buffered edit on ack, at the new baseVersion", () => {
    const session = joined();
    session.localEdit("op-1", insert(0, "ab"));
    session.localEdit("op-2", insert(2, "cd"));

    const sent = session.onAck({ kind: "op:ack", id: "op-1", sequence: 1 });
    expect(sent).toEqual([
      {
        kind: "op:submit",
        roomId: "r",
        id: "op-2",
        op: insert(2, "cd"),
        baseVersion: 1, // the version op-1 established
      },
    ]);
    expect(session.inFlight).toBe(true);
    expect(session.bufferedCount).toBe(0);
  });

  it("ignores an ack that is not the current in-flight op", () => {
    const session = joined();
    session.localEdit("op-1", insert(0, "ab"));
    const sent = session.onAck({ kind: "op:ack", id: "stray", sequence: 9 });
    expect(sent).toEqual([]);
    expect(session.inFlight).toBe(true);
    expect(session.version).toBe(0);
  });
});

describe("ClientSession.onBroadcast", () => {
  it("applies a peer edit when nothing is outstanding", () => {
    const session = joined();
    const sent = session.onBroadcast({
      kind: "op:broadcast",
      roomId: "r",
      op: insert(0, "X"),
      authorId: "bob",
      sequence: 1,
    });
    expect(sent).toEqual([]);
    expect(session.document).toBe("X");
    expect(session.version).toBe(1);
  });

  it("resyncs when a peer edit arrives with local edits outstanding", () => {
    // The transform seam: correct merge needs OT, so for now we resync.
    const session = joined();
    session.localEdit("op-1", insert(0, "ab"));

    const sent = session.onBroadcast({
      kind: "op:broadcast",
      roomId: "r",
      op: insert(0, "X"),
      authorId: "bob",
      sequence: 1,
    });
    expect(sent).toEqual([{ kind: "room:join", roomId: "r" }]);
    expect(session.inFlight).toBe(false);
    expect(session.bufferedCount).toBe(0);
  });
});

describe("ClientSession.onReject", () => {
  it("discards local state and re-joins", () => {
    const session = joined();
    session.localEdit("op-1", insert(0, "ab"));
    const sent = session.onReject({
      kind: "op:reject",
      id: "op-1",
      reason: "stale-version",
    });
    expect(sent).toEqual([{ kind: "room:join", roomId: "r" }]);
    expect(session.inFlight).toBe(false);
    expect(session.bufferedCount).toBe(0);
  });
});
