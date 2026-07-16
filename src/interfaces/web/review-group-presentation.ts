import { DomainClass } from "../../domain/domain-class.ts";
import type { ReviewGroup, ReviewSourceFile } from "../../domain/review/review.ts";

export class ReviewGroupPresentationClass extends DomainClass<{}, {}> {
  public build(params: {
    files: ReviewSourceFile[];
    groups: ReviewGroup[] | undefined;
  }): Array<{ title: string | null; files: ReviewSourceFile[] }> {
    if (!params.groups) {
      return [{ title: null, files: params.files }];
    }

    const fileByLocation = new Map(params.files.map((file) => [file.location, file]));
    const includedLocations = new Set<string>();
    const groups = params.groups.flatMap((group) => {
      const files = group.files.flatMap((location) => {
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
    const unassignedFiles = params.files.filter((file) => !includedLocations.has(file.location));
    if (unassignedFiles.length > 0) {
      groups.push({ title: "Other changes", files: unassignedFiles });
    }
    return groups;
  }
}

export const ReviewGroupPresentation = new ReviewGroupPresentationClass({}, {});
