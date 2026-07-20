/**
 * Tests for apply(). Written alongside the function, per the project's rule
 * that pure cores get their tests immediately -- because these are the parts
 * that must not silently break, and a test suite is the only thing that pins
 * the exact bounds behaviour the rest of the system will lean on.
 *
 * These are example-based tests. The transform code in Phases 13-15 will add
 * randomized/property-based tests on top; apply is simple enough that
 * enumerated cases cover it, and they double as executable documentation of the
 * contract.
 */

import { describe, expect, it } from "vitest";

import { apply, InvalidOperationError } from "./apply.js";

describe("apply insert", () => {
  it("inserts at the start", () => {
    expect(apply("abc", { type: "insert", position: 0, text: "X" })).toBe(
      "Xabc",
    );
  });

  it("inserts in the middle", () => {
    expect(apply("abc", { type: "insert", position: 1, text: "X" })).toBe(
      "aXbc",
    );
  });

  it("appends when position === length", () => {
    expect(apply("abc", { type: "insert", position: 3, text: "X" })).toBe(
      "abcX",
    );
  });

  it("treats an empty insert as a no-op", () => {
    expect(apply("abc", { type: "insert", position: 1, text: "" })).toBe("abc");
  });

  it("rejects a position past the end", () => {
    expect(() =>
      apply("abc", { type: "insert", position: 4, text: "X" }),
    ).toThrow(InvalidOperationError);
  });

  it("rejects a negative position", () => {
    expect(() =>
      apply("abc", { type: "insert", position: -1, text: "X" }),
    ).toThrow(InvalidOperationError);
  });

  it("rejects a non-integer position", () => {
    expect(() =>
      apply("abc", { type: "insert", position: 1.5, text: "X" }),
    ).toThrow(InvalidOperationError);
  });
});

describe("apply delete", () => {
  it("deletes from the middle", () => {
    expect(apply("abcde", { type: "delete", position: 1, length: 2 })).toBe(
      "ade",
    );
  });

  it("deletes through the end", () => {
    expect(apply("abcde", { type: "delete", position: 3, length: 2 })).toBe(
      "abc",
    );
  });

  it("can delete the entire document", () => {
    expect(apply("abc", { type: "delete", position: 0, length: 3 })).toBe("");
  });

  it("rejects a range that runs past the end", () => {
    expect(() =>
      apply("abc", { type: "delete", position: 2, length: 10 }),
    ).toThrow(InvalidOperationError);
  });

  it("rejects a negative position", () => {
    expect(() =>
      apply("abc", { type: "delete", position: -1, length: 1 }),
    ).toThrow(InvalidOperationError);
  });

  it("rejects a non-positive length", () => {
    expect(() =>
      apply("abc", { type: "delete", position: 0, length: 0 }),
    ).toThrow(InvalidOperationError);
  });
});

describe("apply purity", () => {
  it("does not mutate the input and is deterministic", () => {
    const before = "hello";
    const op = { type: "insert", position: 5, text: "!" } as const;
    const first = apply(before, op);
    const second = apply(before, op);
    expect(first).toBe("hello!");
    expect(second).toBe("hello!");
    // The source string is untouched -- apply's only effect is its return value.
    expect(before).toBe("hello");
  });
});
