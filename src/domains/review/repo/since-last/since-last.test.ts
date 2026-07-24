import { describe, expect, it } from "vite-plus/test";
import { ReviewSinceLast } from "./since-last.ts";

describe("ReviewSinceLast", () => {
  it("shows only edits made after the baseline review", () => {
    expect(
      ReviewSinceLast.build({
        baselineFiles: [
          { location: "changed.ts", oldContent: "base", newContent: "reviewed" },
          { location: "unchanged.ts", oldContent: "base", newContent: "reviewed" },
        ],
        currentFiles: [
          { location: "changed.ts", oldContent: "base", newContent: "follow-up" },
          { location: "unchanged.ts", oldContent: "base", newContent: "reviewed" },
          { location: "added.ts", oldContent: "", newContent: "added" },
        ],
        currentContents: new Map(),
      }),
    ).toEqual([
      { location: "changed.ts", oldContent: "reviewed", newContent: "follow-up" },
      { location: "added.ts", oldContent: "", newContent: "added" },
    ]);
  });

  it("includes reviewed files that were reverted or deleted", () => {
    expect(
      ReviewSinceLast.build({
        baselineFiles: [
          { location: "reverted.ts", oldContent: "base", newContent: "reviewed" },
          { location: "deleted.ts", oldContent: "base", newContent: "reviewed" },
        ],
        currentFiles: [],
        currentContents: new Map([
          ["reverted.ts", "base"],
          ["deleted.ts", ""],
        ]),
      }),
    ).toEqual([
      { location: "reverted.ts", oldContent: "reviewed", newContent: "base" },
      { location: "deleted.ts", oldContent: "reviewed", newContent: "" },
    ]);
  });
});
