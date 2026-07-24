import { describe, expect, it } from "vite-plus/test";
import { ReviewWindowTitle } from "./window-title.ts";

describe("ReviewWindowTitle", () => {
  const Title = ReviewWindowTitle;

  it.each([
    ["/Users/rene/GitHub/lgtm", "Review preferences", "lgtm / Review preferences"],
    ["C:\\Users\\rene\\GitHub\\rig", "Review scheduler", "rig / Review scheduler"],
  ])("formats the project directory and review name from %s", (cwd, name, expected) => {
    expect(Title.format({ cwd, name })).toBe(expected);
  });
});
