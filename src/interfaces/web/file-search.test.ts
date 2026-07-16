import { describe, expect, it } from "vite-plus/test";
import type { ReviewSourceFile } from "../../domain/review/review.ts";
import { FileSearch } from "./file-search.ts";

const files = [
  "src/interfaces/web/review-presentation.ts",
  "src/platform/review/review-platform.ts",
  "src/interfaces/web/main.tsx",
  "src/interfaces/mcp/mcp.ts",
  "README.md",
].map(function createFile(location, index): ReviewSourceFile {
  return {
    id: `file-${index}`,
    location,
    language: "typescript",
    oldContent: "",
    newContent: "",
    added: 0,
    removed: 0,
  };
});

describe("FileSearchClass", () => {
  it("preserves the original order for an empty query", () => {
    expect(FileSearch.search({ files, query: "  " })).toBe(files);
    expect(FileSearch.search({ files, query: "---" })).toBe(files);
  });

  it("ranks a matching filename ahead of a path-only match", () => {
    expect(
      FileSearch.search({ files, query: "review platform" }).map((file) => file.location),
    ).toEqual(["src/platform/review/review-platform.ts"]);
  });

  it("matches initials and compact filename queries", () => {
    expect(FileSearch.search({ files, query: "rvpres" })[0]?.location).toBe(
      "src/interfaces/web/review-presentation.ts",
    );
    expect(FileSearch.search({ files, query: "maintsx" })[0]?.location).toBe(
      "src/interfaces/web/main.tsx",
    );
  });

  it("tolerates transpositions and missing characters", () => {
    expect(
      FileSearch.search({ files, query: "reveiw presntation" }).map((file) => file.location),
    ).toEqual(["src/interfaces/web/review-presentation.ts"]);
  });

  it("requires every query term to match", () => {
    expect(FileSearch.search({ files, query: "web mcp" })).toEqual([]);
  });

  it("normalizes case and accents", () => {
    const accentedFile = { ...files[4], location: "Guides/Résumé.md" };
    expect(FileSearch.search({ files: [accentedFile], query: "resume" })).toEqual([accentedFile]);
  });

  it("filters 50,000 indexed files within an interactive time budget", () => {
    const largeFileSet = Array.from({ length: 50_000 }, function createFile(_, index) {
      return {
        id: `large-file-${index}`,
        location: `packages/package-${index % 1_000}/src/components/component-${index}.test.tsx`,
        language: "typescript",
        oldContent: "",
        newContent: "",
        added: 0,
        removed: 0,
      } satisfies ReviewSourceFile;
    });
    FileSearch.prepare({ files: largeFileSet });

    const startedAt = performance.now();
    const exactResult = FileSearch.search({ files: largeFileSet, query: "component 49999" });
    const typoResult = FileSearch.search({ files: largeFileSet, query: "componnet 49999" });
    const compactResult = FileSearch.search({ files: largeFileSet, query: "cmp49999" });
    const duration = performance.now() - startedAt;

    expect(exactResult[0]?.location).toBe(
      "packages/package-999/src/components/component-49999.test.tsx",
    );
    expect(typoResult[0]?.location).toBe(
      "packages/package-999/src/components/component-49999.test.tsx",
    );
    expect(compactResult[0]?.location).toBe(
      "packages/package-999/src/components/component-49999.test.tsx",
    );
    expect(duration).toBeLessThan(1_000);
  });
});
