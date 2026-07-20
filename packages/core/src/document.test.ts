/**
 * Tests for the document-state reducer, now covering concurrency. The linear
 * cases (accept in order) still hold; the new cases exercise rebasing a stale
 * op against the ops it missed -- including the split and the redundant-op
 * outcomes that only appear once transform is in the loop.
 */

import { describe, expect, it } from "vitest";

import { accept, emptyDocument, type DocumentState } from "./document.js";
import type { DeleteOp, InsertOp, Op } from "@syncforge/shared";

const ins = (position: number, text: string): InsertOp => ({
  type: "insert",
  position,
  text,
});
const del = (position: number, length: number): DeleteOp => ({
  type: "delete",
  position,
  length,
});

/** Accept and unwrap, failing loudly if the op was rejected. */
function acc(
  state: DocumentState,
  op: Op,
  baseVersion: number,
): Extract<ReturnType<typeof accept>, { status: "accepted" }> {
  const result = accept(state, op, baseVersion);
  if (result.status !== "accepted") {
    throw new Error(`expected accepted, got ${JSON.stringify(result)}`);
  }
  return result;
}

describe("emptyDocument", () => {
  it("starts empty at version 0 with no history", () => {
    expect(emptyDocument()).toEqual({ content: "", version: 0, history: [] });
  });
});

describe("accept -- linear (baseVersion === version)", () => {
  it("applies the first op and records history", () => {
    const result = accept(emptyDocument(), ins(0, "hi"), 0);
    expect(result).toEqual({
      status: "accepted",
      state: { content: "hi", version: 1, history: [ins(0, "hi")] },
      sequence: 1,
      ops: [ins(0, "hi")],
    });
  });

  it("rejects a future baseVersion", () => {
    const result = accept(emptyDocument(), ins(0, "x"), 5);
    expect(result).toEqual({ status: "rejected", reason: "stale-version" });
  });

  it("rejects an out-of-bounds op as invalid-op", () => {
    const s1 = acc(emptyDocument(), ins(0, "abc"), 0);
    const result = accept(s1.state, del(2, 10), 1);
    expect(result).toEqual({ status: "rejected", reason: "invalid-op" });
  });
});

describe("accept -- concurrent (baseVersion < version) rebases", () => {
  it("rebases a concurrent insert past an already-accepted one", () => {
    const s1 = acc(emptyDocument(), ins(0, "X"), 0); // "X", v1
    const result = accept(s1.state, ins(0, "Y"), 0); // still against v0

    expect(result).toMatchObject({
      status: "accepted",
      ops: [ins(1, "Y")], // shifted past "X"
      sequence: 2,
    });
    expect((result as { state: DocumentState }).state.content).toBe("XY");
  });

  it("splits a rebased delete around a concurrent interior insert", () => {
    const base = acc(emptyDocument(), ins(0, "abcde"), 0); // "abcde", v1
    const withInsert = acc(base.state, ins(2, "XX"), 1); // "abXXcde", v2

    // A delete of [1,4) ("bcd") submitted against v1 -- it missed the insert.
    const result = acc(withInsert.state, del(1, 3), 1);

    expect(result.ops).toEqual([del(4, 2), del(1, 1)]); // split, high offset first
    expect(result.state.content).toBe("aXXe"); // the inserted XX survives
    expect(result.sequence).toBe(4); // one submission, two ops -> version +2
  });

  it("accepts a redundant concurrent delete as a no-op", () => {
    const s1 = acc(emptyDocument(), ins(0, "abc"), 0); // "abc", v1
    const sA = acc(s1.state, del(0, 2), 1); // "c", v2

    const result = acc(sA.state, del(0, 2), 1); // delete the same span again
    expect(result.ops).toEqual([]); // nothing left to remove
    expect(result.state.content).toBe("c"); // unchanged
    expect(result.state.version).toBe(2); // history did not grow
  });
});

describe("accept -- invariant", () => {
  it("keeps version === history.length across mixed accepts", () => {
    let state = emptyDocument();
    state = acc(state, ins(0, "hello"), 0).state;
    state = acc(state, ins(5, "!"), 1).state;
    state = acc(state, ins(0, "Z"), 0).state; // concurrent, written against v0
    expect(state.version).toBe(state.history.length);
  });
});
