import { describe, expect, it } from "vite-plus/test";
import { JsonReviewInput, ReviewGroupsInput } from "./json-input.ts";

const file = {
  location: "src/example.ts",
  oldContent: "before",
  newContent: "after",
};

describe("JsonReviewInput", () => {
  it("parses the documented review object", () => {
    const groups = [{ title: "Runtime", files: [file.location] }];
    expect(
      JsonReviewInput.parse({
        value: { name: "Example review", files: [file], groups },
      }),
    ).toEqual({ name: "Example review", files: [file], groups });
  });

  it("parses the shorthand file array", () => {
    expect(JsonReviewInput.parse({ value: [file] })).toEqual({ files: [file] });
  });

  it("rejects an empty file array", () => {
    expect(() => JsonReviewInput.parse({ value: { files: [] } })).toThrow(
      "JSON review input requires at least one file.",
    );
  });

  it("reports the invalid file field", () => {
    expect(() =>
      JsonReviewInput.parse({
        value: { files: [{ ...file, newContent: 42 }] },
      }),
    ).toThrow("files[0].newContent");
  });
});

describe("ReviewGroupsInput", () => {
  it("parses a groups manifest", () => {
    expect(
      ReviewGroupsInput.parse({
        value: { groups: [{ title: "Tests", files: ["src/example.test.ts"] }] },
      }),
    ).toEqual([{ title: "Tests", files: ["src/example.test.ts"] }]);
  });

  it("rejects group metadata beyond a title and files", () => {
    expect(() =>
      ReviewGroupsInput.parse({
        value: {
          groups: [{ title: "Tests", summary: "Not supported", files: ["example.test.ts"] }],
        },
      }),
    ).toThrow("Invalid review groups input");
  });

  it("rejects empty groups", () => {
    expect(() => ReviewGroupsInput.parse({ value: { groups: [] } })).toThrow(
      "Review grouping requires at least one group.",
    );
  });
});
