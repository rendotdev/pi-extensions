import { openReview } from "../../../../domains/review/index.ts";
import { formatPointer, readInput, reviewOptions, type CliContext } from "../../context/context.ts";
import { JsonReviewInput } from "../../json-input/json-input.ts";

export async function runJsonReview(context: CliContext): Promise<void> {
  const positionalInput = context.args.takePositional({});
  const inputPath = context.args.takeOption({ option: "--input" }) ?? positionalInput;
  await context.runner.run({
    label: "Opening JSON review",
    execute: async (report) => {
      report("Reading review JSON");
      const input = JsonReviewInput.parse({
        value: JSON.parse(await readInput(context, inputPath)) as unknown,
      });
      const name = context.args.takeOption({ option: "--name" }) ?? input.name ?? "JSON review";
      return await openReview(
        { kind: "diff", name, files: input.files, groups: input.groups },
        reviewOptions(context, report),
      );
    },
    renderSuccess: (pointer) => formatPointer(context, pointer),
  });
}
