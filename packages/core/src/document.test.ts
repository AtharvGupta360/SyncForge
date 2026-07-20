/**
 * Tests for the document-state reducer. Like apply's suite, these are written
 * alongside the code and double as executable documentation of the ordering and
 * rejection rules the transport layer will lean on.
 */

import { describe, expect, it } from "vitest";

import { accept, emptyDocument } from "./document.js";

describe("emptyDocument", () => {
  it("starts empty at version 0", () => {
    expect(emptyDocument()).toEqual({ content: "", version: 0 });
  });
});

describe("accept -- happy path", () => {
  it("applies the first op and stamps sequence 1", () => {
    const result = accept(
      emptyDocument(),
      { type: "insert", position: 0, text: "hi" },
      0,
    );
    expect(result).toEqual({
      status: "accepted",
      state: { content: "hi", version: 1 },
      sequence: 1,
    });
  });

  it("increments version and sequence across successive ops", () => {
    const first = accept(
      emptyDocument(),
      { type: "insert", position: 0, text: "ab" },
      0,
    );
    // Type-narrow before reaching into the accepted arm.
    if (first.status !== "accepted") throw new Error("expected accepted");

    const second = accept(
      first.state,
      { type: "insert", position: 2, text: "cd" },
      first.state.version,
    );
    expect(second).toEqual({
      status: "accepted",
      state: { content: "abcd", version: 2 },
      sequence: 2,
    });
  });

  it("accepts a delete op", () => {
    const result = accept(
      { content: "abcde", version: 7 },
      { type: "delete", position: 1, length: 2 },
      7,
    );
    expect(result).toEqual({
      status: "accepted",
      state: { content: "ade", version: 8 },
      sequence: 8,
    });
  });
});

describe("accept -- rejection", () => {
  it("rejects a baseVersion behind the server as stale-version", () => {
    const result = accept(
      { content: "abc", version: 5 },
      { type: "insert", position: 0, text: "X" },
      3,
    );
    expect(result).toEqual({ status: "rejected", reason: "stale-version" });
  });

  it("rejects a baseVersion ahead of the server as stale-version", () => {
    const result = accept(
      { content: "abc", version: 5 },
      { type: "insert", position: 0, text: "X" },
      9,
    );
    expect(result).toEqual({ status: "rejected", reason: "stale-version" });
  });

  it("rejects an out-of-bounds op (right version) as invalid-op", () => {
    const result = accept(
      { content: "abc", version: 2 },
      { type: "delete", position: 2, length: 10 },
      2,
    );
    expect(result).toEqual({ status: "rejected", reason: "invalid-op" });
  });
});

describe("accept -- immutability", () => {
  it("returns a new state without mutating the old one", () => {
    const before = { content: "abc", version: 1 };
    const result = accept(
      before,
      { type: "insert", position: 3, text: "d" },
      1,
    );
    if (result.status !== "accepted") throw new Error("expected accepted");
    expect(result.state).not.toBe(before);
    expect(before).toEqual({ content: "abc", version: 1 });
  });
});
