import type { CliContext } from "../../context/context.ts";
import { runDocumentReview } from "./document-review.ts";
import { runGitReview } from "./git-review.ts";
import { runJsonReview } from "./json-review.ts";
import { runReviewResult } from "./review-result.ts";
import { runWorktreeReview } from "./worktree-review.ts";

export async function runReviewCommand(context: CliContext): Promise<void> {
  const reviewCommand = context.args.takePositional({}) ?? "git";
  if (reviewCommand === "git") {
    await runGitReview(context);
    return;
  }
  if (reviewCommand === "worktree") {
    await runWorktreeReview(context);
    return;
  }
  if (reviewCommand === "json") {
    await runJsonReview(context);
    return;
  }
  if (reviewCommand === "document") {
    await runDocumentReview(context);
    return;
  }
  if (reviewCommand === "result") {
    await runReviewResult(context);
    return;
  }
  throw new Error(`Unknown review command: ${reviewCommand}`);
}
