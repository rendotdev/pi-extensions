import { describe, expect, it } from "vite-plus/test";
import { ReviewFileNavigation } from "./review-file-navigation.ts";

describe("ReviewFileNavigationClass", () => {
  it("reads the selected file from the query string", () => {
    expect(
      ReviewFileNavigation.read({ search: "?theme=dark&file=src%2Finterfaces%2Fweb%2Fmain.tsx" }),
    ).toBe("src/interfaces/web/main.tsx");
  });

  it("returns null for a missing or empty file", () => {
    expect(ReviewFileNavigation.read({ search: "?theme=dark" })).toBeNull();
    expect(ReviewFileNavigation.read({ search: "?file=%20%20" })).toBeNull();
  });

  it("creates a deep link while preserving other query parameters and the hash", () => {
    expect(
      ReviewFileNavigation.createHref({
        href: "http://127.0.0.1:4173/review?theme=dark#comments",
        fileLocation: "src/interfaces/web/main.tsx",
      }),
    ).toBe("/review?theme=dark&file=src%2Finterfaces%2Fweb%2Fmain.tsx#comments");
  });
});
