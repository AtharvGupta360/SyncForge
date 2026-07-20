/**
 * Tests for transform. Two layers:
 *
 *   1. Example tests -- pin the tie-break, the split, and the delete/delete
 *      overlap, readable as spec.
 *   2. A randomized TP1 harness over mixed inserts AND deletes -- the real proof.
 *      A seeded PRNG makes any failure reproducible (print the seed, replay it),
 *      which matters because a transform bug is usually one coordinate collision
 *      in thousands.
 */

import { describe, expect, it } from "vitest";

import { apply } from "./apply.js";
import { transform } from "./transform.js";
import type { DeleteOp, InsertOp, Op } from "@syncforge/shared";

const applyAll = (doc: string, ops: readonly Op[]): string =>
  ops.reduce(apply, doc);

/** TP1: apply a then b' equals apply b then a', with the fixed side mapping. */
function converges(doc: string, a: Op, b: Op): boolean {
  const aPrime = transform(a, b, "left"); // a rewritten to apply after b
  const bPrime = transform(b, a, "right"); // b rewritten to apply after a
  return applyAll(apply(doc, a), bPrime) === applyAll(apply(doc, b), aPrime);
}

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

describe("transform -- insert cases", () => {
  it("shifts a later insert past an earlier insert", () => {
    expect(transform(ins(5, "Y"), ins(2, "XX"), "right")).toEqual([ins(7, "Y")]);
  });

  it("breaks a same-position insert tie by side", () => {
    expect(transform(ins(3, "L"), ins(3, "R"), "left")).toEqual([ins(3, "L")]);
    expect(transform(ins(3, "R"), ins(3, "L"), "right")).toEqual([ins(4, "R")]);
  });

  it("shifts an insert left past an earlier delete", () => {
    expect(transform(ins(5, "Y"), del(1, 2), "left")).toEqual([ins(3, "Y")]);
  });

  it("collapses an insert whose anchor was inside a delete", () => {
    // insert at 3, delete removed [2,6): the anchor is gone, land at 2.
    expect(transform(ins(3, "Y"), del(2, 4), "left")).toEqual([ins(2, "Y")]);
  });
});

describe("transform -- delete cases", () => {
  it("shifts a delete right past an earlier insert", () => {
    expect(transform(del(4, 2), ins(1, "XX"), "left")).toEqual([del(6, 2)]);
  });

  it("splits a delete around an insert that lands inside it", () => {
    // delete [1,5) with an insert of "XX" at 3 -> keep the XX, delete around it.
    // pieces (post-insert coords), highest offset first: [5,7) then [1,3).
    expect(transform(del(1, 4), ins(3, "XX"), "left")).toEqual([
      del(5, 2),
      del(1, 2),
    ]);
  });

  it("subtracts the overlap when two deletes intersect", () => {
    // a=[1,4), b=[2,5): overlap [2,4). a keeps length 1 at position 1.
    expect(transform(del(1, 3), del(2, 3), "left")).toEqual([del(1, 1)]);
  });

  it("returns nothing when a delete is fully subsumed", () => {
    expect(transform(del(2, 2), del(1, 5), "left")).toEqual([]);
  });
});

/* --- a tiny seeded PRNG (mulberry32) so random cases are reproducible --- */
function mulberry32(seed: number): () => number {
  let t = seed >>> 0;
  return () => {
    t += 0x6d2b79f5;
    let x = t;
    x = Math.imul(x ^ (x >>> 15), x | 1);
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

describe("transform -- randomized TP1 over inserts and deletes", () => {
  it("converges for thousands of mixed concurrent pairs", () => {
    const rand = mulberry32(0xc0ffee);
    const alphabet = "abcdefABCDEF";
    const randChar = () => alphabet[Math.floor(rand() * alphabet.length)];

    const randomOp = (doc: string): Op => {
      if (doc.length === 0 || rand() < 0.5) {
        const position = Math.floor(rand() * (doc.length + 1));
        const text = Array.from(
          { length: 1 + Math.floor(rand() * 3) },
          randChar,
        ).join("");
        return { type: "insert", position, text };
      }
      const position = Math.floor(rand() * doc.length);
      const length = 1 + Math.floor(rand() * (doc.length - position));
      return { type: "delete", position, length };
    };

    for (let i = 0; i < 10000; i++) {
      const doc = Array.from(
        { length: Math.floor(rand() * 10) },
        randChar,
      ).join("");
      const a = randomOp(doc);
      const b = randomOp(doc);
      expect(
        converges(doc, a, b),
        `TP1 failed: doc=${JSON.stringify(doc)} a=${JSON.stringify(
          a,
        )} b=${JSON.stringify(b)}`,
      ).toBe(true);
    }
  });
});
