import { DomainClass } from "../domain-class.ts";
import type { DiffReviewFileInput } from "./review.ts";

export class ReviewSinceLastBuilderClass extends DomainClass<{}, {}> {
  public build(params: {
    baselineFiles: DiffReviewFileInput[];
    currentFiles: DiffReviewFileInput[];
    currentContents: ReadonlyMap<string, string>;
  }): DiffReviewFileInput[] {
    const baselineByLocation = new Map(
      params.baselineFiles.map(function indexBaselineFile(file) {
        return [file.location, file] as const;
      }),
    );
    const currentByLocation = new Map(
      params.currentFiles.map(function indexCurrentFile(file) {
        return [file.location, file] as const;
      }),
    );
    const locations = new Set([...baselineByLocation.keys(), ...currentByLocation.keys()]);
    const files: DiffReviewFileInput[] = [];

    for (const location of locations) {
      const baseline = baselineByLocation.get(location);
      const current = currentByLocation.get(location);
      const oldContent = baseline?.newContent ?? current?.oldContent ?? "";
      const newContent = current?.newContent ?? params.currentContents.get(location) ?? oldContent;

      if (oldContent === newContent || oldContent.includes("\0") || newContent.includes("\0")) {
        continue;
      }
      files.push({ location, oldContent, newContent });
    }

    return files;
  }
}

export const ReviewSinceLastBuilder = new ReviewSinceLastBuilderClass({}, {});
