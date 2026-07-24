import { openReview } from "../../../../domains/review/index.ts";
import {
  formatPointer,
  readReviewGroups,
  reviewOptions,
  type CliContext,
} from "../../context/context.ts";

export async function runGitReview(context: CliContext): Promise<void> {
  const name = context.args.takeOption({ option: "--name" });
  const groupsPath = context.args.takeOption({ option: "--groups" });
  const sinceLast = context.args.takeFlag({ flag: "--since-last" });
  const remote = context.args.takeOption({ option: "--remote" });
  const remoteCwd = context.args.takeOption({ option: "--remote-cwd" });
  if (!name) {
    throw new Error("review git requires --name <name>.");
  }
  await context.runner.run({
    label: "Opening Git review",
    execute: async (report) => {
      const groups = await readReviewGroups(context, groupsPath);
      report(sinceLast ? "Collecting changes since the last review" : "Collecting Git changes");
      const collection = await context.gitReview.collect({
        cwd: context.cwd,
        remote,
        remoteCwd,
        sessionId: context.sessionId,
        signal: context.signal,
        sinceLast,
      });
      return await openReview(
        {
          kind: "diff",
          name,
          files: collection.files,
          groups,
          checkpoint: collection.checkpoint,
          source: collection.source,
        },
        reviewOptions(context, report),
      );
    },
    renderSuccess: (pointer) => formatPointer(context, pointer),
  });
}
