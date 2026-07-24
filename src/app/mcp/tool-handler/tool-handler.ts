import { resolve } from "node:path";
import {
  finishReview,
  GitReview,
  openReview,
  type OpenReviewInput,
  type OpenReviewOptions,
} from "../../../domains/review/index.ts";
import {
  jsonReviewFiles,
  optionalBoolean,
  optionalReviewGroups,
  optionalString,
  parseToolArguments,
  requiredString,
} from "../parsing/parsing.ts";
import type { JsonObject, McpRuntimeDependencies } from "../types/types.ts";

const gitReview = new GitReview();
const defaultDependencies: McpRuntimeDependencies = {
  collectGitReview: gitReview.collect.bind(gitReview),
  finishReview,
  openReview,
};

type ToolRequest = {
  args: JsonObject;
  cwd: string;
  signal: AbortSignal;
  dependencies: McpRuntimeDependencies;
};

export function createMcpToolHandler(dependencies: McpRuntimeDependencies = defaultDependencies) {
  return async function handleTool(name: string, argumentsValue: unknown, signal: AbortSignal) {
    const args = parseToolArguments(argumentsValue);
    const request: ToolRequest = {
      args,
      cwd: resolve(optionalString(args, "cwd") ?? process.cwd()),
      signal,
      dependencies,
    };
    if (name === "open_git_review") {
      return await openGitReview(request);
    }
    if (name === "open_worktree_review") {
      return await openWorktreeReview(request);
    }
    if (name === "open_json_review") {
      return await openJsonReview(request);
    }
    if (name === "open_document_review") {
      return await openDocumentReview(request);
    }
    if (name === "finish_review") {
      return await finishRequestedReview(request);
    }
    throw new Error(`Unknown LGTM tool: ${name}`);
  };
}

async function openGitReview(request: ToolRequest) {
  const collection = await request.dependencies.collectGitReview({
    cwd: request.cwd,
    remote: optionalString(request.args, "remote"),
    remoteCwd: optionalString(request.args, "remoteCwd"),
    sessionId: process.env.LGTM_SESSION_ID ?? process.env.CODEX_THREAD_ID,
    signal: request.signal,
    sinceLast: optionalBoolean(request.args, "sinceLast"),
  });
  return await openRequestedReview(request, request.cwd, {
    kind: "diff",
    name: requiredString(request.args, "name"),
    files: collection.files,
    groups: optionalReviewGroups(request.args.groups),
    checkpoint: collection.checkpoint,
    source: collection.source,
  });
}

async function openWorktreeReview(request: ToolRequest) {
  const remote = optionalString(request.args, "remote");
  const requestedWorktree = requiredString(request.args, "path");
  const worktree = remote ? request.cwd : resolve(request.cwd, requestedWorktree);
  const collection = await request.dependencies.collectGitReview({
    cwd: worktree,
    remote,
    remoteCwd: remote ? requestedWorktree : undefined,
    signal: request.signal,
  });
  return await openRequestedReview(request, worktree, {
    kind: "diff",
    name: optionalString(request.args, "name") ?? "Worktree review",
    files: collection.files,
    groups: optionalReviewGroups(request.args.groups),
    source: collection.source,
  });
}

async function openJsonReview(request: ToolRequest) {
  return await openRequestedReview(request, request.cwd, {
    kind: "diff",
    name: optionalString(request.args, "name") ?? "JSON review",
    files: jsonReviewFiles(request.args.files),
    groups: optionalReviewGroups(request.args.groups),
  });
}

async function openDocumentReview(request: ToolRequest) {
  return await openRequestedReview(request, request.cwd, {
    kind: "document",
    name: optionalString(request.args, "name") ?? "Document review",
    document: {
      markdown: requiredString(request.args, "markdown"),
      location: optionalString(request.args, "location"),
    },
  });
}

async function finishRequestedReview(request: ToolRequest) {
  const reviewPath = requiredString(request.args, "reviewPath");
  return await request.dependencies.finishReview(request.cwd, reviewPath);
}

async function openRequestedReview(request: ToolRequest, cwd: string, input: OpenReviewInput) {
  const options: OpenReviewOptions = {
    cwd,
    signal: request.signal,
    stopOnAbort: false,
    cleanupOnExit: false,
    onUpdate: (message) => process.stderr.write(`${message}\n`),
  };
  const pointer = await request.dependencies.openReview(input, options);
  return { status: "open" as const, ...pointer };
}
