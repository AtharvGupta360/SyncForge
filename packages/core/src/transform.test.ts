/**
 * Tests for transform. Two layers:
 *
 *   1. Example tests -- pin the tie-break and the basic shift, readable as spec.
 *   2. A randomized TP1 harness -- the real proof. It generates concurrent edits
 *      and asserts both application orders converge. A seeded PRNG makes any
 *      failure reproducible (print the seed, replay it), which matters because a
 *      transform bug is often one specific coordinate collision in a thousand.
 */

import { describe, expect, it } from "vitest";

import { apply } from "./apply.js";
import { transform } from "./transform.js";
import type { InsertOp } from "@syncforge/shared";

/** Transform a concurrent pair and return [a', b'] with a fixed side mapping. */
function transformPair(a: InsertOp, b: InsertOp): [InsertOp, InsertOp] {
  // `a` is left (earlier on ties), `b` is right. Both sides of the network must
  // agree this way round; here the test plays both sides.
  return [
    transform(a, b, "left") as InsertOp,
    transform(b, a, "right") as InsertOp,
  ];
}

/** TP1: applying a then b' equals applying b then a'. */
function converges(doc: string, a: InsertOp, b: InsertOp): boolean {
  const [aPrime, bPrime] = transformPair(a, b);
  return apply(apply(doc, a), bPrime) === apply(apply(doc, b), aPrime);
}

const ins = (position: number, text: string): InsertOp => ({
  type: "insert",
  position,
  text,
});

describe("transform insert/insert -- examples", () => {
  it("shifts a later insert past an earlier one", () => {
    // b inserts after a; transformed to apply after a, it moves right by |a|.
    expect(transform(ins(5, "Y"), ins(2, "XX"), "right")).toEqual(ins(7, "Y"));
  });

  it("leaves an earlier insert untouched by a later one", () => {
    expect(transform(ins(2, "X"), ins(5, "Y"), "left")).toEqual(ins(2, "X"));
  });

  it("breaks a same-position tie by side: left stays, right shifts", () => {
    expect(transform(ins(3, "L"), ins(3, "R"), "left")).toEqual(ins(3, "L"));
    expect(transform(ins(3, "R"), ins(3, "L"), "right")).toEqual(ins(4, "R"));
  });

  it("converges on the classic same-position collision", () => {
    // Both orders must yield the same doc: "LR", not one "LR" and one "RL".
    const a = ins(0, "L");
    const b = ins(0, "R");
    const [aPrime, bPrime] = transformPair(a, b);
    const left = apply(apply("", a), bPrime);
    const right = apply(apply("", b), aPrime);
    expect(left).toBe(right);
    expect(left).toBe("LR");
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

describe("transform insert/insert -- randomized TP1", () => {
  it("converges for thousands of concurrent insert pairs", () => {
    const rand = mulberry32(0xc0ffee);
    const alphabet = "abcdefABCDEF";

    for (let i = 0; i < 5000; i++) {
      const doc = Array.from(
        { length: Math.floor(rand() * 8) },
        () => alphabet[Math.floor(rand() * alphabet.length)],
      ).join("");

      const randInsert = (): InsertOp => {
        const position = Math.floor(rand() * (doc.length + 1));
        const len = 1 + Math.floor(rand() * 3);
        const text = Array.from(
          { length: len },
          () => alphabet[Math.floor(rand() * alphabet.length)],
        ).join("");
        return ins(position, text);
      };

      const a = randInsert();
      const b = randInsert();
      expect(
        converges(doc, a, b),
        `TP1 failed for doc=${JSON.stringify(doc)} a=${JSON.stringify(
          a,
        )} b=${JSON.stringify(b)}`,
      ).toBe(true);
    }
  });
});
