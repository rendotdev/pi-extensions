import { describe, expect, it } from "vite-plus/test";
import { ReviewWindowTitleClass } from "./window-title.ts";

describe("ReviewWindowTitleClass", () => {
  const title = new ReviewWindowTitleClass();

  it.each([
    ["/Users/rene/GitHub/lgtm", "lgtm ⋅ lgtm"],
    ["C:\\Users\\rene\\GitHub\\rig", "lgtm ⋅ rig"],
  ])("formats the project directory from %s", (cwd, expected) => {
    expect(title.format({ cwd })).toBe(expected);
  });
});
