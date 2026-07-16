#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  finishReview,
  openReview,
  ReviewIdentifier,
  serveReviewApp,
  stopReviews,
} from "../../platform/review/review-platform.ts";
import { GitReviewCommand } from "../../platform/review/git-review-command.ts";
import type { ReviewPointer } from "../../domain/review/review.ts";
import {
  AgentInstallPlanner,
  AgentUpdatePlanner,
  isAgentInstallTarget,
} from "../../domain/install/agent-install.ts";
import { AgentInstaller, AgentUpdater } from "../../platform/install/agent-install-platform.ts";
import { CliUpdater } from "../../platform/install/cli-update-platform.ts";
import { runMcpServer } from "../mcp/mcp.ts";
import { JsonReviewInputParser, ReviewGroupsInputParser } from "./json-review-input.ts";
import { CliCommandRunnerClass } from "./cli-command-runner.ts";
import { CommandUiRenderer } from "./command-ui.tsx";

const args = process.argv.slice(2);
if (args[0] === "--") {
  args.shift();
}
const helpRequested = args.includes("--help") || args.includes("-h");
const command = helpRequested
  ? "help"
  : args[0] && !args[0].startsWith("--")
    ? (args.shift() as string)
    : "help";
const jsonOutput = takeFlag("--json");
const cwd = resolve(takeOption("--cwd") ?? process.cwd());
const configuredReviewSessionId = process.env.LGTM_SESSION_ID ?? process.env.CODEX_THREAD_ID;
const reviewSessionId = configuredReviewSessionId
  ? ReviewIdentifier.sanitizePathSegment({ value: configuredReviewSessionId })
  : undefined;
const cancellation = new AbortController();
let cancelling = false;
let commandErrorRendered = false;
const CliCommandRunner = new CliCommandRunnerClass(
  { jsonOutput },
  {
    markErrorRendered: function markErrorRendered() {
      commandErrorRendered = true;
    },
    renderer: CommandUiRenderer,
    writeJson: function writeJson(value) {
      console.log(JSON.stringify(value, null, 2));
    },
  },
);

async function cancel() {
  if (cancelling) {
    return;
  }
  cancelling = true;
  cancellation.abort();
  await stopReviews(cwd).catch(() => false);
}

process.once("SIGINT", () => {
  void cancel().finally(() => process.exit(130));
});
process.once("SIGTERM", () => {
  void cancel().finally(() => process.exit(143));
});

function takeFlag(flag: string) {
  const index = args.indexOf(flag);
  if (index < 0) {
    return false;
  }
  args.splice(index, 1);
  return true;
}

function takeOption(option: string) {
  const index = args.indexOf(option);
  if (index < 0) {
    return undefined;
  }
  const value = args[index + 1];
  const isMissingValue = !value || value.startsWith("--");
  if (isMissingValue) {
    throw new Error(`${option} requires a value.`);
  }
  args.splice(index, 2);
  return value;
}

function reviewOptions(report: (label: string) => void) {
  return {
    cwd,
    sessionId: reviewSessionId,
    signal: cancellation.signal,
    onUpdate: jsonOutput ? undefined : report,
  };
}

function formatPointer(pointer: ReviewPointer) {
  return CommandUiRenderer.formatDetail({
    lines: [
      `lgtm review opened: ${pointer.name}`,
      `URL: ${pointer.url}`,
      `Review JSON: ${pointer.reviewPath}`,
    ],
  });
}

async function readStdin() {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf8");
}

async function readInput(path: string | undefined) {
  return path ? await readFile(resolve(cwd, path), "utf8") : await readStdin();
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

async function readReviewGroups(path: string | undefined) {
  if (!path) {
    return undefined;
  }
  return ReviewGroupsInputParser.parse({
    value: JSON.parse(await readInput(path)) as unknown,
  });
}

async function main() {
  if (command === "mcp") {
    await runMcpServer();
    return;
  }

  if (command === "serve") {
    const appDir = takeOption("--app-dir");
    if (!appDir) {
      throw new Error("serve requires --app-dir.");
    }
    await serveReviewApp(appDir);
    return;
  }

  const isSetupCommand = command === "setup" || command === "install";
  if (isSetupCommand) {
    const target = takeOption("--target") ?? "all";
    if (!isAgentInstallTarget(target)) {
      throw new Error("setup --target must be one of: all, pi, claude, codex.");
    }
    const plan = AgentInstallPlanner.createPlan({ target });
    if (takeFlag("--dry-run")) {
      await CliCommandRunner.run({
        label: "Planning lgtm setup",
        execute: async () => ({ action: "setup" as const, target, steps: plan, dryRun: true }),
        renderSuccess: function renderSuccess(result) {
          return CommandUiRenderer.formatIntegrationResult(result);
        },
      });
      return;
    }
    await CliCommandRunner.run({
      label: "Setting up lgtm integrations",
      execute: async () => ({
        action: "setup" as const,
        target,
        steps: await AgentInstaller.install({ target }),
      }),
      renderSuccess: function renderSuccess(result) {
        return CommandUiRenderer.formatIntegrationResult(result);
      },
    });
    return;
  }

  if (command === "update") {
    const target = takeOption("--target") ?? "all";
    if (!isAgentInstallTarget(target)) {
      throw new Error("update --target must be one of: all, pi, claude, codex.");
    }
    const plan = AgentUpdatePlanner.createPlan({ target });
    if (takeFlag("--dry-run")) {
      await CliCommandRunner.run({
        label: "Planning lgtm update",
        execute: async () => ({
          action: "update" as const,
          target,
          steps: plan,
          cli: await CliUpdater.plan(),
          dryRun: true,
        }),
        renderSuccess: function renderSuccess(result) {
          return CommandUiRenderer.formatIntegrationResult(result);
        },
      });
      return;
    }
    await CliCommandRunner.run({
      label: "Preparing lgtm update",
      successLabel: "Update finished",
      execute: async function execute(report) {
        report.complete({ label: `Current version: ${CliUpdater.getCurrentVersion()}` });
        report("Checking for updates");
        const cliPlan = await CliUpdater.plan();
        let cli;
        if (cliPlan.status === "ready") {
          report.complete({
            label: `Update available: ${cliPlan.currentVersion} to ${cliPlan.latestVersion}`,
          });
          report("Updating CLI");
          cli = await CliUpdater.update({ plan: cliPlan });
          if (cli.status !== "updated") {
            throw new Error("lgtm did not apply the available CLI update.");
          }
          report.complete({
            label: `Updated CLI: ${cli.previousVersion} to ${cli.version}`,
            detail: CommandUiRenderer.formatCommandOutputGroups({
              steps: [cli.step],
              outputs: [cli.output],
            }),
            mutedDetail: true,
          });
        } else if (cliPlan.status === "current") {
          cli = cliPlan;
          report.complete({ label: "Already up to date" });
        } else {
          cli = cliPlan;
          report.complete({ label: "CLI update unavailable", detail: `  ${cliPlan.reason}` });
        }

        report("Checking integrations");
        const integrations = await AgentUpdater.update({
          target,
          onUpdate: function onUpdate(event) {
            const name = CommandUiRenderer.formatIntegrationName({ target: event.target });
            const label = `Updating integration: ${name}`;
            if (event.phase === "started") {
              report(label);
              return;
            }
            report.complete({
              label,
              detail: CommandUiRenderer.formatCommandOutputGroups({
                steps: event.steps,
                outputs: event.outputs,
              }),
              mutedDetail: true,
            });
          },
        });
        return { action: "update" as const, target, cli, ...integrations };
      },
      renderSuccess: function renderSuccess() {
        return "Restart your agent session to reload lgtm integrations, or use the lgtm CLI now.";
      },
    });
    return;
  }

  if (command === "help") {
    if (jsonOutput) {
      console.log(helpText());
      return;
    }
    await CliCommandRunner.run({
      label: "Showing lgtm help",
      execute: async () => undefined,
      renderSuccess: helpText,
    });
    return;
  }

  if (command === "review") {
    const reviewCommand = args[0] && !args[0].startsWith("--") ? (args.shift() as string) : "git";

    if (reviewCommand === "git") {
      const name = takeOption("--name");
      const groupsPath = takeOption("--groups");
      const sinceLast = takeFlag("--since-last");
      const remote = takeOption("--remote");
      const remoteCwd = takeOption("--remote-cwd");
      if (!name) {
        throw new Error("review git requires --name <name>.");
      }
      await CliCommandRunner.run({
        label: "Opening Git review",
        execute: async (report) => {
          const groups = await readReviewGroups(groupsPath);
          report(sinceLast ? "Collecting changes since the last review" : "Collecting Git changes");
          const collection = await GitReviewCommand.collect({
            cwd,
            remote,
            remoteCwd,
            sessionId: reviewSessionId,
            signal: cancellation.signal,
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
            reviewOptions(report),
          );
        },
        renderSuccess: formatPointer,
      });
      return;
    }

    if (reviewCommand === "worktree") {
      const worktree = args.shift();
      if (!worktree) {
        throw new Error("worktree requires a path.");
      }
      const name = takeOption("--name") ?? "Worktree review";
      const groupsPath = takeOption("--groups");
      const remote = takeOption("--remote");
      await CliCommandRunner.run({
        label: "Opening worktree review",
        execute: async (report) => {
          const groups = await readReviewGroups(groupsPath);
          report("Collecting worktree changes");
          const collection = await GitReviewCommand.collect({
            cwd: remote ? cwd : resolve(cwd, worktree),
            remote,
            remoteCwd: remote ? worktree : undefined,
            signal: cancellation.signal,
          });
          return await openReview(
            {
              kind: "diff",
              name,
              files: collection.files,
              groups,
              source: collection.source,
            },
            reviewOptions(report),
          );
        },
        renderSuccess: formatPointer,
      });
      return;
    }

    if (reviewCommand === "json") {
      const positionalInput = args[0]?.startsWith("--") ? undefined : args.shift();
      const inputPath = takeOption("--input") ?? positionalInput;
      await CliCommandRunner.run({
        label: "Opening JSON review",
        execute: async (report) => {
          report("Reading review JSON");
          const input = JsonReviewInputParser.parse({
            value: JSON.parse(await readInput(inputPath)) as unknown,
          });
          const name = takeOption("--name") ?? input.name ?? "JSON review";
          return await openReview(
            { kind: "diff", name, files: input.files, groups: input.groups },
            reviewOptions(report),
          );
        },
        renderSuccess: formatPointer,
      });
      return;
    }

    if (reviewCommand === "document") {
      const documentPath = args[0]?.startsWith("--") ? undefined : args.shift();
      await CliCommandRunner.run({
        label: "Opening document review",
        execute: async (report) => {
          report("Reading Markdown document");
          const markdown = await readInput(documentPath);
          if (!markdown.trim()) {
            throw new Error("Document review requires Markdown input.");
          }
          const name =
            takeOption("--name") ?? (documentPath ? `Review ${documentPath}` : "Document review");
          return await openReview(
            { kind: "document", name, document: { markdown, location: documentPath } },
            reviewOptions(report),
          );
        },
        renderSuccess: formatPointer,
      });
      return;
    }

    if (reviewCommand === "result") {
      const reviewPath = takeOption("--review-path");
      if (!reviewPath) {
        throw new Error("result requires --review-path.");
      }
      await CliCommandRunner.run({
        label: "Reading lgtm review result",
        execute: async () => await finishReview(cwd, reviewPath),
        renderSuccess: (result) =>
          !result.found
            ? "No lgtm review found."
            : result.review.status === "open"
              ? `${result.formattedReview}\n\nReview is still open. Server left running.`
              : `${result.formattedReview}\n\nServer stopped: ${result.stoppedServer ? "yes" : "no"}`,
      });
      return;
    }

    throw new Error(`Unknown review command: ${reviewCommand}`);
  }

  throw new Error(`Unknown command: ${command}`);
}

main().catch((error) => {
  if (!commandErrorRendered) {
    console.error(error instanceof Error ? error.message : String(error));
  }
  process.exitCode = 1;
});
