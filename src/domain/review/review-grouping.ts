import { DomainClass } from "../domain-class.ts";
import type { ReviewGroup, ReviewGroupInput, ReviewSourceFile } from "./review.ts";

export class ReviewGroupingClass extends DomainClass<{ fallbackTitle: string }, {}> {
  public build(params: {
    files: ReviewSourceFile[];
    groups: ReviewGroupInput[] | undefined;
  }): ReviewGroup[] | undefined {
    if (!params.groups) {
      return undefined;
    }

    const changedLocations = new Set(params.files.map((file) => file.location));
    const assignedLocations = new Set<string>();
    const groups: ReviewGroup[] = [];

    for (const inputGroup of params.groups) {
      const title = inputGroup.title.trim();
      if (!title) {
        continue;
      }
      const files = inputGroup.files.filter((location) => {
        const shouldSkipLocation =
          !changedLocations.has(location) || assignedLocations.has(location);
        if (shouldSkipLocation) {
          return false;
        }
        assignedLocations.add(location);
        return true;
      });
      if (files.length > 0) {
        groups.push({ title, files });
      }
    }

    const unassignedFiles = params.files
      .map((file) => file.location)
      .filter((location) => !assignedLocations.has(location));
    if (unassignedFiles.length > 0) {
      groups.push({ title: this.params.fallbackTitle, files: unassignedFiles });
    }

    return groups;
  }
}

export const ReviewGrouping = new ReviewGroupingClass({ fallbackTitle: "Other changes" }, {});
