import { describe, expect, it } from "vite-plus/test";
import { DocumentMarkdownNavigation } from "./document-markdown-navigation.ts";

describe("DocumentMarkdownNavigation", () => {
  it("keeps document anchors in the current tab and opens other links externally", () => {
    expect(DocumentMarkdownNavigation.linkAttributes({ href: "#details" })).toEqual({});
    expect(
      DocumentMarkdownNavigation.linkAttributes({
        href: "https://example.com/guide#details",
      }),
    ).toEqual({ target: "_blank", rel: "noreferrer" });
  });

  it("adds stable, unique IDs to rendered headings", () => {
    const tree = {
      type: "root",
      children: [
        {
          type: "element",
          tagName: "h2",
          properties: {},
          children: [{ type: "text", value: "Details" }],
        },
        {
          type: "element",
          tagName: "h2",
          properties: {},
          children: [
            { type: "text", value: "API " },
            {
              type: "element",
              tagName: "code",
              children: [{ type: "text", value: "Details" }],
            },
          ],
        },
        {
          type: "element",
          tagName: "h3",
          properties: {},
          children: [{ type: "text", value: "Details" }],
        },
      ],
    };
    const transform = DocumentMarkdownNavigation.buildHeadingIdPlugin({})();

    transform(tree);

    expect(tree.children[0]?.properties).toEqual({ id: "details" });
    expect(tree.children[1]?.properties).toEqual({ id: "api-details" });
    expect(tree.children[2]?.properties).toEqual({ id: "details-1" });
  });
});
