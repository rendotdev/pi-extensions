import type { ReviewGroup, ReviewSourceFile } from "../../types/review.ts";

export const ReviewGroupPresentation = {
  build(params: {
    files: ReviewSourceFile[];
    groups: ReviewGroup[] | undefined;
  }): Array<{ title: string | null; files: ReviewSourceFile[] }> {
    if (!params.groups) {
      return [{ title: null, files: params.files }];
    }

    const fileByLocation = new Map(
      params.files.map(function indexFile(file) {
        return [file.location, file];
      }),
    );
    const includedLocations = new Set<string>();
    const groups = params.groups.flatMap(function buildGroup(group) {
      const files = group.files.flatMap(function includeFile(location) {
        const file = fileByLocation.get(location);
        const shouldSkipFile = !file || includedLocations.has(location);
        if (shouldSkipFile) {
          return [];
        }
        includedLocations.add(location);
        return [file];
      });
      return files.length > 0 ? [{ title: group.title, files }] : [];
    });
    const unassignedFiles = params.files.filter(function isUnassigned(file) {
      return !includedLocations.has(file.location);
    });
    if (unassignedFiles.length > 0) {
      groups.push({ title: "Other changes", files: unassignedFiles });
    }
    return groups;
  },
};
