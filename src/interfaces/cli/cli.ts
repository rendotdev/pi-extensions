#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  collectGitReviewFiles,
  finishReview,
  openReview,
  serveReviewApp,
  stopReviews,
} from "../../platform/review/review-platform.ts";
import type { ReviewPointer } from "../../domain/review/review.ts";
import {
  agentInstallPlanner,
  agentUpdatePlanner,
  isAgentInstallTarget,
  type AgentInstallStep,
  type AgentInstallTarget,
} from "../../domain/install/agent-install.ts";
import { agentInstaller, agentUpdater } from "../../platform/install/agent-install-platform.ts";
import { cliUpdater, type CliUpdateResult } from "../../platform/install/cli-update-platform.ts";
import { runMcpServer } from "../mcp/mcp.ts";
import { JsonReviewInputParser } from "./json-review-input.ts";
import { CommandUiRenderer } from "./command-ui.ts";

const args = process.argv.slice(2);
if (args[0] === "--") args.shift();
const helpRequested = args.includes("--help") || args.includes("-h");
const command = helpRequested
  ? "help"
  : args[0] && !args[0].startsWith("--")
    ? (args.shift() as string)
    : "help";
const jsonOutput = takeFlag("--json");
const cwd = resolve(takeOption("--cwd") ?? process.cwd());
const cancellation = new AbortController();
let cancelling = false;
let commandErrorRendered = false;

async function cancel() {
  if (cancelling) return;
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
  if (index < 0) return false;
  args.splice(index, 1);
  return true;
}

function takeOption(option: string) {
  const index = args.indexOf(option);
  if (index < 0) return undefined;
  const value = args[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`${option} requires a value.`);
  args.splice(index, 2);
  return value;
}

function reviewOptions(report: (label: string) => void) {
  return {
    cwd,
    signal: cancellation.signal,
    onUpdate: jsonOutput ? undefined : report,
  };
}

function formatPointer(pointer: ReviewPointer) {
  return CommandUiRenderer.formatDetail({
    lines: [
      `LGTM review opened: ${pointer.name}`,
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
  return `LGTM, human approval for agent work

Usage:
  lgtm review [git] --name <name> [--cwd <path>] [--json]
  lgtm review worktree <path> [--name <name>] [--cwd <path>] [--json]
  lgtm review json [review.json] [--name <name>] [--cwd <path>] [--json]
  lgtm review document [markdown-file] [--name <name>] [--cwd <path>] [--json]
  lgtm review result --review-path <path> [--cwd <path>] [--json]
  lgtm mcp
  lgtm setup [--target <all|pi|claude|codex>] [--dry-run] [--json]
  lgtm update [--target <all|pi|claude|codex>] [--dry-run] [--json]

JSON review schema:
  {
    "name": "Review name",
    "files": [
      { "location": "file.ts", "oldContent": "before", "newContent": "after" }
    ]
  }

Run \`lgtm review\` to review current Git changes. Document Markdown and review JSON are read from stdin when no file is supplied. Review outcomes are \`approved\`, \`changes_requested\`, or \`canceled\`.`;
}

function formatIntegrationResult(params: {
  action: "setup" | "update";
  target: AgentInstallTarget;
  steps: AgentInstallStep[];
  skippedTargets?: Exclude<AgentInstallTarget, "all">[];
  cli?: CliUpdateResult;
}) {
  const lines: string[] = [];
  if (params.cli?.status === "updated") lines.push("Updated the LGTM CLI.");
  if (params.cli?.status === "skipped") lines.push(`Skipped CLI update: ${params.cli.reason}`);
  lines.push(
    `${params.action === "setup" ? "Set up" : "Updated"} LGTM integrations for ${params.target}. Start a new agent session to load the plugin and skill.`,
  );
  if (params.skippedTargets?.length) {
    lines.push(`Skipped uninstalled integrations: ${params.skippedTargets.join(", ")}.`);
  }
  return CommandUiRenderer.formatDetail({ lines });
}

async function runCommand<Result>(params: {
  label: string;
  execute: (report: (label: string) => void) => Promise<Result>;
  renderSuccess: (result: Result) => string;
}): Promise<Result> {
  if (jsonOutput) {
    const result = await params.execute(() => undefined);
    console.log(JSON.stringify(result, null, 2));
    return result;
  }
  try {
    return await CommandUiRenderer.run(params);
  } catch (error) {
    commandErrorRendered = true;
    throw error;
  }
}

async function main() {
  if (command === "mcp") {
    await runMcpServer();
    return;
  }

  if (command === "serve") {
    const appDir = takeOption("--app-dir");
    if (!appDir) throw new Error("serve requires --app-dir.");
    await serveReviewApp(appDir);
    return;
  }

  if (command === "setup" || command === "install") {
    const target = takeOption("--target") ?? "all";
    if (!isAgentInstallTarget(target)) {
      throw new Error("setup --target must be one of: all, pi, claude, codex.");
    }
    const plan = agentInstallPlanner.createPlan({ target });
    if (takeFlag("--dry-run")) {
      await runCommand({
        label: "Planning LGTM setup",
        execute: async () => ({ action: "setup" as const, target, steps: plan }),
        renderSuccess: formatIntegrationResult,
      });
      return;
    }
    await runCommand({
      label: "Setting up LGTM integrations",
      execute: async () => ({
        action: "setup" as const,
        target,
        steps: await agentInstaller.install({ target }),
      }),
      renderSuccess: formatIntegrationResult,
    });
    return;
  }

  if (command === "update") {
    const target = takeOption("--target") ?? "all";
    if (!isAgentInstallTarget(target)) {
      throw new Error("update --target must be one of: all, pi, claude, codex.");
    }
    const plan = agentUpdatePlanner.createPlan({ target });
    if (takeFlag("--dry-run")) {
      await runCommand({
        label: "Planning LGTM update",
        execute: async () => ({
          action: "update" as const,
          target,
          steps: plan,
          cli: cliUpdater.plan(),
        }),
        renderSuccess: formatIntegrationResult,
      });
      return;
    }
    await runCommand({
      label: "Updating LGTM integrations",
      execute: async () => ({
        action: "update" as const,
        target,
        cli: await cliUpdater.update(),
        ...(await agentUpdater.update({ target })),
      }),
      renderSuccess: formatIntegrationResult,
    });
    return;
  }

  if (command === "help") {
    if (jsonOutput) {
      console.log(helpText());
      return;
    }
    await runCommand({
      label: "Showing LGTM help",
      execute: async () => undefined,
      renderSuccess: helpText,
    });
    return;
  }

  if (command === "review") {
    const reviewCommand = args[0] && !args[0].startsWith("--") ? (args.shift() as string) : "git";

    if (reviewCommand === "git") {
      const name = takeOption("--name");
      if (!name) throw new Error("review git requires --name <name>.");
      await runCommand({
        label: "Opening Git review",
        execute: async (report) => {
          report("Collecting Git changes");
          const files = await collectGitReviewFiles(cwd);
          return await openReview({ kind: "diff", name, files }, reviewOptions(report));
        },
        renderSuccess: formatPointer,
      });
      return;
    }

    if (reviewCommand === "worktree") {
      const worktree = args.shift();
      if (!worktree) throw new Error("worktree requires a path.");
      const name = takeOption("--name") ?? "Worktree review";
      await runCommand({
        label: "Opening worktree review",
        execute: async (report) => {
          report("Collecting worktree changes");
          const files = await collectGitReviewFiles(resolve(cwd, worktree));
          return await openReview({ kind: "diff", name, files }, reviewOptions(report));
        },
        renderSuccess: formatPointer,
      });
      return;
    }

    if (reviewCommand === "json") {
      const positionalInput = args[0]?.startsWith("--") ? undefined : args.shift();
      const inputPath = takeOption("--input") ?? positionalInput;
      await runCommand({
        label: "Opening JSON review",
        execute: async (report) => {
          report("Reading review JSON");
          const input = JsonReviewInputParser.parse({
            value: JSON.parse(await readInput(inputPath)) as unknown,
          });
          const name = takeOption("--name") ?? input.name ?? "JSON review";
          return await openReview(
            { kind: "diff", name, files: input.files },
            reviewOptions(report),
          );
        },
        renderSuccess: formatPointer,
      });
      return;
    }

    if (reviewCommand === "document") {
      const documentPath = args[0]?.startsWith("--") ? undefined : args.shift();
      await runCommand({
        label: "Opening document review",
        execute: async (report) => {
          report("Reading Markdown document");
          const markdown = await readInput(documentPath);
          if (!markdown.trim()) throw new Error("Document review requires Markdown input.");
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
      if (!reviewPath) throw new Error("result requires --review-path.");
      await runCommand({
        label: "Reading LGTM review result",
        execute: async () => await finishReview(cwd, reviewPath),
        renderSuccess: (result) =>
          !result.found
            ? "No LGTM review found."
            : `${result.formattedReview}\n\nServer stopped: ${result.stoppedServer ? "yes" : "no"}`,
      });
      return;
    }

    throw new Error(`Unknown review command: ${reviewCommand}`);
  }

  throw new Error(`Unknown command: ${command}`);
}

main().catch((error) => {
  if (!commandErrorRendered) console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
