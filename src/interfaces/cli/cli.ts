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
import type { DiffReviewFileInput, ReviewPointer } from "../../domain/review/review.ts";
import {
  agentInstallPlanner,
  agentUpdatePlanner,
  isAgentInstallTarget,
  type AgentInstallStep,
  type AgentInstallTarget,
} from "../../domain/install/agent-install.ts";
import { agentInstaller, agentUpdater } from "../../platform/install/agent-install-platform.ts";
import { runMcpServer } from "../mcp/mcp.ts";

const args = process.argv.slice(2);
if (args[0] === "--") args.shift();
const command = args.shift() ?? "help";
const jsonOutput = takeFlag("--json");
const cwd = resolve(takeOption("--cwd") ?? process.cwd());
const cancellation = new AbortController();
let cancelling = false;

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

function reviewOptions() {
  return {
    cwd,
    signal: cancellation.signal,
    onUpdate: jsonOutput ? undefined : (message: string) => console.error(message),
  };
}

function printPointer(pointer: ReviewPointer) {
  if (jsonOutput) {
    console.log(JSON.stringify(pointer, null, 2));
    return;
  }
  console.log(`LGTM review opened: ${pointer.name}`);
  console.log(`URL: ${pointer.url}`);
  console.log(`Review JSON: ${pointer.reviewPath}`);
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

function assertFiles(value: unknown): asserts value is DiffReviewFileInput[] {
  if (!Array.isArray(value) || value.length === 0)
    throw new Error("Custom review input requires a non-empty files array.");
  for (const file of value) {
    if (!file || typeof file !== "object")
      throw new Error("Every custom review file must be an object.");
    const candidate = file as Record<string, unknown>;
    if (
      typeof candidate.location !== "string" ||
      typeof candidate.oldContent !== "string" ||
      typeof candidate.newContent !== "string"
    ) {
      throw new Error(
        "Every custom review file requires location, oldContent, and newContent strings.",
      );
    }
  }
}

function printHelp() {
  console.log(`LGTM, human approval for agent work

Usage:
  lgtm git [--name <name>] [--cwd <path>] [--json]
  lgtm worktree <path> [--name <name>] [--cwd <path>] [--json]
  lgtm custom [--input <review.json>] [--name <name>] [--cwd <path>] [--json]
  lgtm document [markdown-file] [--name <name>] [--cwd <path>] [--json]
  lgtm finish [--cwd <path>] [--json]
  lgtm stop [--cwd <path>] [--json]
  lgtm mcp
  lgtm install [--target <all|pi|claude|codex>] [--dry-run] [--json]
  lgtm update [--target <all|pi|claude|codex>] [--dry-run] [--json]

Custom input:
  { "name": "Review name", "files": [{ "location": "file.ts", "oldContent": "", "newContent": "" }] }

Document Markdown and custom JSON are read from stdin when no file is supplied.`);
}

function printIntegrationResult(params: {
  action: "install" | "update";
  target: AgentInstallTarget;
  steps: AgentInstallStep[];
  skippedTargets?: Exclude<AgentInstallTarget, "all">[];
}) {
  if (jsonOutput) {
    console.log(JSON.stringify(params, null, 2));
    return;
  }
  console.log(
    `${params.action === "install" ? "Installed" : "Updated"} LGTM for ${params.target}. Start a new agent session to load the plugin and skill.`,
  );
  if (params.skippedTargets?.length) {
    console.log(`Skipped uninstalled integrations: ${params.skippedTargets.join(", ")}.`);
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

  if (command === "install") {
    const target = takeOption("--target") ?? "all";
    if (!isAgentInstallTarget(target)) {
      throw new Error("install --target must be one of: all, pi, claude, codex.");
    }
    const plan = agentInstallPlanner.createPlan({ target });
    if (takeFlag("--dry-run")) {
      printIntegrationResult({ action: "install", target, steps: plan });
      return;
    }
    printIntegrationResult({
      action: "install",
      target,
      steps: await agentInstaller.install({ target }),
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
      printIntegrationResult({ action: "update", target, steps: plan });
      return;
    }
    printIntegrationResult({
      action: "update",
      target,
      ...(await agentUpdater.update({ target })),
    });
    return;
  }

  if (command === "help" || command === "--help" || command === "-h") {
    printHelp();
    return;
  }

  if (command === "git") {
    const name = takeOption("--name") ?? "Git review";
    const files = await collectGitReviewFiles(cwd);
    printPointer(await openReview({ kind: "diff", name, files }, reviewOptions()));
    return;
  }

  if (command === "worktree") {
    const worktree = args.shift();
    if (!worktree) throw new Error("worktree requires a path.");
    const name = takeOption("--name") ?? "Worktree review";
    const files = await collectGitReviewFiles(resolve(cwd, worktree));
    printPointer(await openReview({ kind: "diff", name, files }, reviewOptions()));
    return;
  }

  if (command === "custom") {
    const inputPath = takeOption("--input");
    const parsed = JSON.parse(await readInput(inputPath)) as
      | { name?: unknown; files?: unknown }
      | unknown[];
    const files = Array.isArray(parsed) ? parsed : parsed.files;
    assertFiles(files);
    const inputName = Array.isArray(parsed) ? undefined : parsed.name;
    const name =
      takeOption("--name") ?? (typeof inputName === "string" ? inputName : "Custom review");
    printPointer(await openReview({ kind: "diff", name, files }, reviewOptions()));
    return;
  }

  if (command === "document") {
    const documentPath = args[0]?.startsWith("--") ? undefined : args.shift();
    const markdown = await readInput(documentPath);
    if (!markdown.trim()) throw new Error("Document review requires Markdown input.");
    const name =
      takeOption("--name") ?? (documentPath ? `Review ${documentPath}` : "Document review");
    printPointer(
      await openReview(
        {
          kind: "document",
          name,
          document: { markdown, location: documentPath },
        },
        reviewOptions(),
      ),
    );
    return;
  }

  if (command === "finish") {
    const result = await finishReview(cwd);
    if (jsonOutput) console.log(JSON.stringify(result, null, 2));
    else if (!result.found) console.log("No LGTM review found.");
    else
      console.log(
        `${result.formattedReview}\n\nServer stopped: ${result.stoppedServer ? "yes" : "no"}`,
      );
    return;
  }

  if (command === "stop") {
    const stopped = await stopReviews(cwd);
    if (jsonOutput) console.log(JSON.stringify({ stopped }));
    else
      console.log(
        stopped ? "Stopped the LGTM review server." : "No running LGTM review server found.",
      );
    return;
  }

  throw new Error(`Unknown command: ${command}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
