import { resolve } from "node:path";
import { openReview } from "../../../../domains/review/index.ts";
import {
  formatPointer,
  readReviewGroups,
  reviewOptions,
  type CliContext,
} from "../../context/context.ts";

export async function runWorktreeReview(context: CliContext): Promise<void> {
  const worktree = context.args.takePositional({});
  if (!worktree) {
    throw new Error("worktree requires a path.");
  }
  const name = context.args.takeOption({ option: "--name" }) ?? "Worktree review";
  const groupsPath = context.args.takeOption({ option: "--groups" });
  const remote = context.args.takeOption({ option: "--remote" });
  await context.runner.run({
    label: "Opening worktree review",
    execute: async (report) => {
      const groups = await readReviewGroups(context, groupsPath);
      report("Collecting worktree changes");
      const collection = await context.gitReview.collect({
        cwd: remote ? context.cwd : resolve(context.cwd, worktree),
        remote,
        remoteCwd: remote ? worktree : undefined,
        signal: context.signal,
      });
      return await openReview(
        {
          kind: "diff",
          name,
          files: collection.files,
          groups,
          source: collection.source,
        },
        reviewOptions(context, report),
      );
    },
    renderSuccess: (pointer) => formatPointer(context, pointer),
  });
}
