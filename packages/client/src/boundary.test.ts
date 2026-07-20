/**
 * Tests for the Monaco boundary. The point of the boundary being pure is that
 * these run with no editor and no browser -- just data in, ops out -- which is
 * why the translation lives here and not tangled into an event handler.
 */

import { describe, expect, it } from "vitest";

import { changesToOps, type EditorChange } from "./boundary.js";

describe("changesToOps -- single change", () => {
  it("maps a pure insert to one insert op", () => {
    const changes: EditorChange[] = [
      { rangeOffset: 3, rangeLength: 0, text: "X" },
    ];
    expect(changesToOps(changes)).toEqual([
      { type: "insert", position: 3, text: "X" },
    ]);
  });

  it("maps a pure delete to one delete op", () => {
    const changes: EditorChange[] = [
      { rangeOffset: 2, rangeLength: 4, text: "" },
    ];
    expect(changesToOps(changes)).toEqual([
      { type: "delete", position: 2, length: 4 },
    ]);
  });

  it("decomposes a replace into delete-then-insert at the same offset", () => {
    const changes: EditorChange[] = [
      { rangeOffset: 5, rangeLength: 3, text: "hi" },
    ];
    expect(changesToOps(changes)).toEqual([
      { type: "delete", position: 5, length: 3 },
      { type: "insert", position: 5, text: "hi" },
    ]);
  });

  it("produces nothing for a no-op change", () => {
    const changes: EditorChange[] = [
      { rangeOffset: 0, rangeLength: 0, text: "" },
    ];
    expect(changesToOps(changes)).toEqual([]);
  });
});

describe("changesToOps -- multi-cursor ordering", () => {
  it("emits ops highest-offset first so lower offsets stay valid", () => {
    // Two cursors typing "!" at once, given in ascending order. If we applied
    // the offset-2 op first it would shift the offset-8 op by one; sorting
    // descending keeps both coordinates correct against the pre-edit document.
    const changes: EditorChange[] = [
      { rangeOffset: 2, rangeLength: 0, text: "!" },
      { rangeOffset: 8, rangeLength: 0, text: "!" },
    ];
    expect(changesToOps(changes)).toEqual([
      { type: "insert", position: 8, text: "!" },
      { type: "insert", position: 2, text: "!" },
    ]);
  });

  it("is not fooled by input already sorted the wrong way", () => {
    const changes: EditorChange[] = [
      { rangeOffset: 1, rangeLength: 1, text: "" },
      { rangeOffset: 10, rangeLength: 2, text: "ab" },
    ];
    expect(changesToOps(changes)).toEqual([
      { type: "delete", position: 10, length: 2 },
      { type: "insert", position: 10, text: "ab" },
      { type: "delete", position: 1, length: 1 },
    ]);
  });
});
