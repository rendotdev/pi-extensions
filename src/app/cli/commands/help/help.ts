import type { CliContext } from "../../context/context.ts";

export async function runHelpCommand(context: CliContext): Promise<void> {
  if (context.jsonOutput) {
    console.log(helpText());
    return;
  }
  await context.runner.run({
    label: "Showing lgtm help",
    execute: async () => undefined,
    renderSuccess: helpText,
  });
}

function helpText() {
  return `lgtm, human approval for agent work

Usage:
  lgtm review [git] --name <name> [--groups <groups.json>] [--since-last] [--remote <ssh-destination> --remote-cwd <absolute-path>] [--cwd <path>] [--json]
  lgtm review worktree <path> [--groups <groups.json>] [--remote <ssh-destination>] [--name <name>] [--cwd <path>] [--json]
  lgtm review json [review.json] [--name <name>] [--cwd <path>] [--json]
  lgtm review document [markdown-file] [--name <name>] [--cwd <path>] [--json]
  lgtm review result --review-path <path> [--cwd <path>] [--json]
  lgtm mcp
  lgtm setup [--target <all|pi|claude|codex>] [--dry-run] [--json]
  lgtm update [--target <all|pi|claude|codex>] [--dry-run] [--json]

JSON review schema:
  {
    "name": "Review name",
    "groups": [
      { "title": "Runtime", "files": ["file.ts"] }
    ],
    "files": [
      { "location": "file.ts", "oldContent": "before", "newContent": "after" }
    ]
  }

Run \`lgtm review --name "Review current changes"\` to review current Git changes. Add \`--groups <groups.json>\` to arrange changed files into authored groups; unassigned files remain visible under Other changes. Add \`--remote <ssh-destination> --remote-cwd <absolute-path>\` to read a repository from another machine through the system SSH configuration. Add \`--since-last\` to show only changes made after the most recent compatible lgtm diff review with an approved or changes-requested outcome. Document Markdown and review JSON are read from stdin when no file is supplied. Review outcomes are \`approved\`, \`changes_requested\`, or \`canceled\`.`;
}
