import { openReview } from "../../../../domains/review/index.ts";
import { formatPointer, readInput, reviewOptions, type CliContext } from "../../context/context.ts";

export async function runDocumentReview(context: CliContext): Promise<void> {
  const documentPath = context.args.takePositional({});
  await context.runner.run({
    label: "Opening document review",
    execute: async (report) => {
      report("Reading Markdown document");
      const markdown = await readInput(context, documentPath);
      if (!markdown.trim()) {
        throw new Error("Document review requires Markdown input.");
      }
      const name =
        context.args.takeOption({ option: "--name" }) ??
        (documentPath ? `Review ${documentPath}` : "Document review");
      return await openReview(
        { kind: "document", name, document: { markdown, location: documentPath } },
        reviewOptions(context, report),
      );
    },
    renderSuccess: (pointer) => formatPointer(context, pointer),
  });
}
