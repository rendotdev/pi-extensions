import { describe, expect, it } from "vite-plus/test";
import { ReviewWindowTitleClass } from "./window-title.ts";

describe("ReviewWindowTitleClass", () => {
  const Title = new ReviewWindowTitleClass({}, {});

  it.each([
    ["/Users/rene/GitHub/lgtm", "Review preferences", "lgtm / Review preferences"],
    ["C:\\Users\\rene\\GitHub\\rig", "Review scheduler", "rig / Review scheduler"],
  ])("formats the project directory and review name from %s", (cwd, name, expected) => {
    expect(Title.format({ cwd, name })).toBe(expected);
  });
});
