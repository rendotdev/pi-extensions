import { homeRouteDeps } from "./home-route-deps.ts";
import type { DiffReviewContentItem, DiffReviewSidebarItem } from "./diff-review-list-types.ts";

export function buildReviewGroupItems(
  group: ReturnType<typeof homeRouteDeps.reviewGroupPresentation.build>[number],
  index: number,
): DiffReviewContentItem[] {
  const files = group.files.map((file) => ({ kind: "file" as const, file }));
  if (!group.title) {
    return files;
  }
  const totals = group.files.reduce(
    (sum, file) => ({ added: sum.added + file.added, removed: sum.removed + file.removed }),
    { added: 0, removed: 0 },
  );
  return [
    {
      kind: "group",
      key: `group-${index}-${group.title}`,
      title: group.title,
      fileCount: group.files.length,
      ...totals,
    },
    ...files,
  ];
}

export function diffReviewItemKey(
  item: DiffReviewContentItem | DiffReviewSidebarItem | undefined,
  index: number,
) {
  return item?.kind === "file" ? item.file.id : (item?.key ?? index);
}

export function estimateReviewItemSize(
  item: DiffReviewContentItem | undefined,
  collapsedFileIds: Set<string>,
) {
  if (!item) {
    return 120;
  }
  if (item.kind === "group") {
    return 72;
  }
  if (collapsedFileIds.has(item.file.id)) {
    return 82;
  }
  return Math.max(120, 112 + (item.file.added + item.file.removed) * 22);
}
