import { defineRepo } from "../../../../define.ts";
import type { DiffReviewFileInput } from "../../types/review.ts";

export class ReviewSinceLastRepository extends defineRepo({
  params: {},
  deps: {},
}) {
  public build(params: {
    baselineFiles: DiffReviewFileInput[];
    currentFiles: DiffReviewFileInput[];
    currentContents: ReadonlyMap<string, string>;
  }): DiffReviewFileInput[] {
    function buildFiles(params: {
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
        const newContent =
          current?.newContent ?? params.currentContents.get(location) ?? oldContent;

        const shouldSkipFile =
          oldContent === newContent || oldContent.includes("\0") || newContent.includes("\0");
        if (shouldSkipFile) {
          continue;
        }
        files.push({ location, oldContent, newContent });
      }

      return files;
    }

    return buildFiles(params);
  }
}

export const ReviewSinceLast = new ReviewSinceLastRepository();
