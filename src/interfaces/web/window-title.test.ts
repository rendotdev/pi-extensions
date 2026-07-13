import { describe, expect, it } from "vite-plus/test";
import { ReviewWindowTitleClass } from "./window-title.ts";

describe("ReviewWindowTitleClass", () => {
  const title = new ReviewWindowTitleClass({}, {});

  it.each([
    ["/Users/rene/GitHub/lgtm", "Review preferences", "lgtm / Review preferences"],
    ["C:\\Users\\rene\\GitHub\\rig", "Review scheduler", "rig / Review scheduler"],
  ])("formats the project directory and review name from %s", (cwd, name, expected) => {
    expect(title.format({ cwd, name })).toBe(expected);
  });
});
