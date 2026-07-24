#!/usr/bin/env node

import { resolve } from "node:path";
import { defineApp } from "../../define.ts";
import { GitReview, ReviewIdentifier, serveReviewApp } from "../../domains/review/index.ts";
import { AgentInstaller, AgentUpdater, CliUpdater } from "../../domains/setup/index.ts";
import { runMcpServer } from "../mcp/mcp.ts";
import { CliArguments } from "./arguments/arguments.ts";
import { registerCancellationHandlers } from "./cancellation/cancellation.ts";
import { runHelpCommand } from "./commands/help/help.ts";
import { runReviewCommand } from "./commands/review/review.ts";
import { runSetupCommand } from "./commands/setup/setup.ts";
import { runUpdateCommand } from "./commands/update/update.ts";
import type { CliContext } from "./context/context.ts";
import { CliCommandRunner } from "./runner/runner.ts";
import { CommandUiRenderer } from "./ui/ui.tsx";

const args = new CliArguments(process.argv.slice(2));
const command = args.takeCommand({ fallback: "help" });
const jsonOutput = args.takeFlag({ flag: "--json" });
const cwd = resolve(args.takeOption({ option: "--cwd" }) ?? process.cwd());
const configuredSessionId = process.env.LGTM_SESSION_ID ?? process.env.CODEX_THREAD_ID;
const sessionId = configuredSessionId
  ? ReviewIdentifier.sanitizePathSegment({ value: configuredSessionId })
  : undefined;
const cancellation = new AbortController();
let commandErrorRendered = false;
const renderer = new CommandUiRenderer();
const context: CliContext = {
  args,
  cwd,
  sessionId,
  signal: cancellation.signal,
  jsonOutput,
  renderer,
  gitReview: new GitReview(),
  agentInstaller: new AgentInstaller(),
  agentUpdater: new AgentUpdater(),
  cliUpdater: new CliUpdater(),
  runner: new CliCommandRunner({
    params: { jsonOutput },
    deps: {
      markErrorRendered: function markErrorRendered() {
        commandErrorRendered = true;
      },
      renderer,
      writeJson: function writeJson(value) {
        console.log(JSON.stringify(value, null, 2));
      },
    },
  }),
};

registerCancellationHandlers({ controller: cancellation, cwd });

async function runCommand(): Promise<void> {
  if (command === "mcp") {
    await runMcpServer();
    return;
  }
  if (command === "serve") {
    const appDir = args.takeOption({ option: "--app-dir" });
    if (!appDir) {
      throw new Error("serve requires --app-dir.");
    }
    await serveReviewApp(appDir);
    return;
  }
  const isSetupCommand = command === "setup" || command === "install";
  if (isSetupCommand) {
    await runSetupCommand(context);
    return;
  }
  if (command === "update") {
    await runUpdateCommand(context);
    return;
  }
  if (command === "help") {
    await runHelpCommand(context);
    return;
  }
  if (command === "review") {
    await runReviewCommand(context);
    return;
  }
  throw new Error(`Unknown command: ${command}`);
}

await defineApp({
  params: {},
  deps: { runCommand },
  async run() {
    await this.deps.runCommand().catch(function handleError(error) {
      if (!commandErrorRendered) {
        console.error(error instanceof Error ? error.message : String(error));
      }
      process.exitCode = 1;
    });
  },
});
