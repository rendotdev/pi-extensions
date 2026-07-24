import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { GitReview, OpenReviewOptions, ReviewPointer } from "../../../domains/review/index.ts";
import type { AgentInstaller, AgentUpdater, CliUpdater } from "../../../domains/setup/index.ts";
import { ReviewGroupsInput } from "../json-input/json-input.ts";
import type { CliCommandRunner } from "../runner/runner.ts";
import type { CommandUiRenderer } from "../ui/ui.tsx";
import type { CliArguments } from "../arguments/arguments.ts";

export type CliContext = {
  args: CliArguments;
  cwd: string;
  sessionId: string | undefined;
  signal: AbortSignal;
  jsonOutput: boolean;
  runner: CliCommandRunner;
  renderer: CommandUiRenderer;
  gitReview: GitReview;
  agentInstaller: AgentInstaller;
  agentUpdater: AgentUpdater;
  cliUpdater: CliUpdater;
};

export function reviewOptions(
  context: CliContext,
  report: (label: string) => void,
): OpenReviewOptions {
  return {
    cwd: context.cwd,
    sessionId: context.sessionId,
    signal: context.signal,
    onUpdate: context.jsonOutput ? undefined : report,
  };
}

export function formatPointer(context: CliContext, pointer: ReviewPointer): string {
  return context.renderer.formatDetail({
    lines: [
      `lgtm review opened: ${pointer.name}`,
      `URL: ${pointer.url}`,
      `Review JSON: ${pointer.reviewPath}`,
    ],
  });
}

export async function readInput(context: CliContext, path: string | undefined): Promise<string> {
  if (path) {
    return await readFile(resolve(context.cwd, path), "utf8");
  }
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf8");
}

export async function readReviewGroups(context: CliContext, path: string | undefined) {
  if (!path) {
    return undefined;
  }
  return ReviewGroupsInput.parse({
    value: JSON.parse(await readInput(context, path)) as unknown,
  });
}
