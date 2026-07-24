import { finishReview } from "../../../../domains/review/index.ts";
import type { CliContext } from "../../context/context.ts";

export async function runReviewResult(context: CliContext): Promise<void> {
  const reviewPath = context.args.takeOption({ option: "--review-path" });
  if (!reviewPath) {
    throw new Error("result requires --review-path.");
  }
  await context.runner.run({
    label: "Reading lgtm review result",
    execute: async () => await finishReview(context.cwd, reviewPath),
    renderSuccess: (result) => {
      if (!result.found) {
        return "No lgtm review found.";
      }
      const isOpen = result.review.status === "open";
      return isOpen
        ? `${result.formattedReview}\n\nReview is still open. Server left running.`
        : `${result.formattedReview}\n\nServer stopped: ${result.stoppedServer ? "yes" : "no"}`;
    },
  });
}
