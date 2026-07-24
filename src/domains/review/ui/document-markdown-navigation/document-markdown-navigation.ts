type MarkdownTreeNode = {
  type?: string;
  tagName?: string;
  value?: string;
  properties?: Record<string, unknown>;
  children?: MarkdownTreeNode[];
};

export const DocumentMarkdownNavigation = {
  buildHeadingIdPlugin(params: {}) {
    void params;
    return createHeadingIdTransformer;
  },

  linkAttributes(params: { href?: string }) {
    const isDocumentAnchor = params.href?.startsWith("#") ?? false;
    if (isDocumentAnchor) {
      return {};
    }
    return { target: "_blank" as const, rel: "noreferrer" };
  },
};

function addHeadingIds(params: { tree: MarkdownTreeNode }): void {
  const slugCounts = new Map<string, number>();
  visitNode({ node: params.tree, slugCounts });
}

function createHeadingIdTransformer() {
  return transformHeadingIds;
}

function transformHeadingIds(tree: MarkdownTreeNode): void {
  addHeadingIds({ tree });
}

function visitNode(params: { node: MarkdownTreeNode; slugCounts: Map<string, number> }): void {
  const isHeading = /^h[1-6]$/.test(params.node.tagName ?? "");
  if (isHeading) {
    const text = readText({ node: params.node });
    const baseSlug = slugify({ text });
    const occurrence = params.slugCounts.get(baseSlug) ?? 0;
    params.slugCounts.set(baseSlug, occurrence + 1);
    const id = occurrence === 0 ? baseSlug : `${baseSlug}-${occurrence}`;
    params.node.properties = { ...params.node.properties, id };
  }
  for (const child of params.node.children ?? []) {
    visitNode({ node: child, slugCounts: params.slugCounts });
  }
}

function readText(params: { node: MarkdownTreeNode }): string {
  if (params.node.type === "text") {
    return params.node.value ?? "";
  }
  return (params.node.children ?? []).map((child) => readText({ node: child })).join("");
}

function slugify(params: { text: string }): string {
  return params.text
    .trim()
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}\s_-]/gu, "")
    .replace(/\s+/g, "-");
}
