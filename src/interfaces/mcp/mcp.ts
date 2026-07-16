import { createInterface } from "node:readline";
import { resolve } from "node:path";
import {
  finishReview,
  openReview,
  stopReview,
  waitForReview,
  type OpenReviewOptions,
} from "../../platform/review/review-platform.ts";
import { GitReviewCommand } from "../../platform/review/git-review-command.ts";
import type {
  DiffReviewFileInput,
  OpenReviewInput,
  ReviewGroupInput,
  ReviewPointer,
} from "../../domain/review/review.ts";

type JsonObject = Record<string, unknown>;
type JsonRpcId = string | number | null;

type JsonRpcRequest = {
  jsonrpc: "2.0";
  id?: JsonRpcId;
  method: string;
  params?: JsonObject;
};

const MCP_PROTOCOL_VERSION = "2025-06-18";

type McpTool = {
  name: string;
  description: string;
  inputSchema: JsonObject;
};

export type McpRuntimeDependencies = {
  collectGitReview: typeof GitReviewCommand.collect;
  finishReview: typeof finishReview;
  openReview: typeof openReview;
  stopReview: typeof stopReview;
  waitForReview: typeof waitForReview;
};

const defaultDependencies: McpRuntimeDependencies = {
  collectGitReview: GitReviewCommand.collect.bind(GitReviewCommand),
  finishReview,
  openReview,
  stopReview,
  waitForReview,
};

const commonProperties = {
  cwd: {
    type: "string",
    description: "Project directory. Defaults to the MCP server working directory.",
  },
  name: { type: "string", description: "Human-readable review name." },
};

const remoteProperties = {
  remote: {
    type: "string",
    description: "Optional OpenSSH destination or SSH config alias.",
  },
  remoteCwd: {
    type: "string",
    description: "Absolute repository path on the remote machine. Required with remote.",
  },
  sinceLast: {
    type: "boolean",
    description: "Review only changes since the newest compatible completed lgtm review.",
  },
};

const groupsProperty = {
  type: "array",
  minItems: 1,
  description: "Optional conceptual file groups in review order.",
  items: {
    type: "object",
    properties: {
      title: { type: "string" },
      files: { type: "array", minItems: 1, items: { type: "string" } },
    },
    required: ["title", "files"],
    additionalProperties: false,
  },
};

export const mcpTools: McpTool[] = [
  {
    name: "open_git_review",
    description:
      "Open local or SSH-hosted Git changes for human review and wait for approval, requested changes, or cancellation.",
    inputSchema: {
      type: "object",
      properties: { ...commonProperties, ...remoteProperties, groups: groupsProperty },
      required: ["name"],
      additionalProperties: false,
    },
  },
  {
    name: "open_worktree_review",
    description:
      "Open changes from a local or SSH-hosted Git worktree for human review and wait for a decision.",
    inputSchema: {
      type: "object",
      properties: {
        ...commonProperties,
        remote: remoteProperties.remote,
        groups: groupsProperty,
        path: {
          type: "string",
          description: "Local worktree path, or an absolute remote worktree path with remote.",
        },
      },
      required: ["path"],
      additionalProperties: false,
    },
  },
  {
    name: "open_json_review",
    description:
      "Open explicitly supplied before-and-after file content for human review and wait for a decision. Each file requires location, oldContent, and newContent strings.",
    inputSchema: {
      type: "object",
      properties: {
        ...commonProperties,
        groups: groupsProperty,
        files: {
          type: "array",
          minItems: 1,
          items: {
            type: "object",
            properties: {
              location: { type: "string" },
              oldContent: { type: "string" },
              newContent: { type: "string" },
            },
            required: ["location", "oldContent", "newContent"],
            additionalProperties: false,
          },
        },
      },
      required: ["files"],
      additionalProperties: false,
    },
  },
  {
    name: "open_document_review",
    description: "Open Markdown for human review and wait for a decision.",
    inputSchema: {
      type: "object",
      properties: {
        ...commonProperties,
        markdown: { type: "string", description: "Markdown content to review." },
        location: { type: "string", description: "Optional source document location." },
      },
      required: ["markdown"],
      additionalProperties: false,
    },
  },
  {
    name: "finish_review",
    description:
      "Read the specified review result. Leave an open review running, or stop its local server after a terminal decision.",
    inputSchema: {
      type: "object",
      properties: {
        cwd: commonProperties.cwd,
        reviewPath: {
          type: "string",
          description: "review.json path returned when opening the review.",
        },
      },
      required: ["reviewPath"],
      additionalProperties: false,
    },
  },
];

function optionalString(argumentsValue: JsonObject, name: string) {
  const value = argumentsValue[name];
  if (value === undefined) {
    return undefined;
  }
  const isInvalidValue = typeof value !== "string" || value.length === 0;
  if (isInvalidValue) {
    throw new Error(`${name} must be a non-empty string.`);
  }
  return value;
}

function requiredString(argumentsValue: JsonObject, name: string) {
  const value = optionalString(argumentsValue, name);
  if (!value) {
    throw new Error(`${name} is required.`);
  }
  return value;
}

function optionalBoolean(argumentsValue: JsonObject, name: string) {
  const value = argumentsValue[name];
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "boolean") {
    throw new Error(`${name} must be a boolean.`);
  }
  return value;
}

function jsonReviewFiles(value: unknown): DiffReviewFileInput[] {
  const isInvalidFiles = !Array.isArray(value) || value.length === 0;
  if (isInvalidFiles) {
    throw new Error("files must be a non-empty array.");
  }
  return value.map((entry, index) => {
    const isInvalidEntry = !entry || typeof entry !== "object";
    if (isInvalidEntry) {
      throw new Error(`files[${index}] must be an object.`);
    }
    const file = entry as JsonObject;
    return {
      location: requiredString(file, "location"),
      oldContent: requiredStringAllowEmpty(file, "oldContent"),
      newContent: requiredStringAllowEmpty(file, "newContent"),
    };
  });
}

function optionalReviewGroups(value: unknown): ReviewGroupInput[] | undefined {
  if (value === undefined) {
    return undefined;
  }
  const isInvalidGroups = !Array.isArray(value) || value.length === 0;
  if (isInvalidGroups) {
    throw new Error("groups must be a non-empty array.");
  }
  return value.map((entry, index) => {
    const isInvalidEntry = !entry || typeof entry !== "object" || Array.isArray(entry);
    if (isInvalidEntry) {
      throw new Error(`groups[${index}] must be an object.`);
    }
    const group = entry as JsonObject;
    const extraKeys = Object.keys(group).filter((key) => key !== "title" && key !== "files");
    if (extraKeys.length > 0) {
      throw new Error(`groups[${index}] has unsupported fields: ${extraKeys.join(", ")}.`);
    }
    if (!Array.isArray(group.files)) {
      throw new Error(`groups[${index}].files must be a non-empty array.`);
    }
    if (group.files.length === 0) {
      throw new Error(`groups[${index}].files must be a non-empty array.`);
    }
    return {
      title: requiredString(group, "title"),
      files: group.files.map((file, fileIndex) => {
        const isInvalidFile = typeof file !== "string" || file.length === 0;
        if (isInvalidFile) {
          throw new Error(`groups[${index}].files[${fileIndex}] must be a non-empty string.`);
        }
        return file;
      }),
    };
  });
}

function requiredStringAllowEmpty(value: JsonObject, name: string) {
  if (typeof value[name] !== "string") {
    throw new Error(`${name} must be a string.`);
  }
  return value[name];
}

async function openAndWait(
  input: OpenReviewInput,
  cwd: string,
  signal: AbortSignal,
  dependencies: McpRuntimeDependencies,
  onOpened?: (pointer: ReviewPointer) => void,
) {
  let pointer: ReviewPointer | undefined;
  try {
    const options: OpenReviewOptions = {
      cwd,
      signal,
      cleanupOnExit: true,
      onUpdate: (message) => process.stderr.write(`${message}\n`),
    };
    pointer = await dependencies.openReview(input, options);
    onOpened?.(pointer);
    const completion = await dependencies.waitForReview(pointer, { cwd, signal });
    return {
      status: completion.review.status,
      reviewPath: completion.reviewPath,
      stoppedServer: completion.stoppedServer,
      review: completion.review,
      formattedReview: completion.formattedReview,
    };
  } catch (error) {
    if (pointer) {
      await dependencies.stopReview(cwd, pointer.reviewPath).catch(() => false);
    }
    throw error;
  }
}

export function createMcpToolHandler(dependencies: McpRuntimeDependencies = defaultDependencies) {
  const activeOpensByCwd = new Map<string, { controller: AbortController; reviewPath?: string }>();

  async function openBlockingReview(input: OpenReviewInput, cwd: string, signal: AbortSignal) {
    if (activeOpensByCwd.has(cwd)) {
      throw new Error(`An LGTM review is already pending for ${cwd}.`);
    }

    const controller = new AbortController();
    const activeOpen = { controller, reviewPath: undefined as string | undefined };
    const linkedSignal = AbortSignal.any([signal, controller.signal]);
    activeOpensByCwd.set(cwd, activeOpen);
    try {
      return await openAndWait(input, cwd, linkedSignal, dependencies, (pointer) => {
        activeOpen.reviewPath = pointer.reviewPath;
      });
    } finally {
      if (activeOpensByCwd.get(cwd) === activeOpen) {
        activeOpensByCwd.delete(cwd);
      }
    }
  }

  function abortActiveOpen(cwd: string, reviewPath: string | undefined, message: string) {
    const activeOpen = activeOpensByCwd.get(cwd);
    if (!activeOpen) {
      return;
    }
    const isDifferentReview = reviewPath && activeOpen.reviewPath !== reviewPath;
    if (isDifferentReview) {
      return;
    }
    activeOpen.controller.abort(new DOMException(message, "AbortError"));
  }

  return async (name: string, argumentsValue: unknown, signal: AbortSignal) => {
    const args =
      argumentsValue === undefined
        ? {}
        : argumentsValue && typeof argumentsValue === "object" && !Array.isArray(argumentsValue)
          ? (argumentsValue as JsonObject)
          : (() => {
              throw new Error("Tool arguments must be an object.");
            })();
    const cwd = resolve(optionalString(args, "cwd") ?? process.cwd());
    const reviewName = optionalString(args, "name");
    if (name === "open_git_review") {
      const collection = await dependencies.collectGitReview({
        cwd,
        remote: optionalString(args, "remote"),
        remoteCwd: optionalString(args, "remoteCwd"),
        sessionId: process.env.LGTM_SESSION_ID ?? process.env.CODEX_THREAD_ID,
        signal,
        sinceLast: optionalBoolean(args, "sinceLast"),
      });
      return await openBlockingReview(
        {
          kind: "diff",
          name: requiredString(args, "name"),
          files: collection.files,
          groups: optionalReviewGroups(args.groups),
          checkpoint: collection.checkpoint,
          source: collection.source,
        },
        cwd,
        signal,
      );
    }

    if (name === "open_worktree_review") {
      const remote = optionalString(args, "remote");
      const requestedWorktree = requiredString(args, "path");
      const worktree = remote ? cwd : resolve(cwd, requestedWorktree);
      const collection = await dependencies.collectGitReview({
        cwd: worktree,
        remote,
        remoteCwd: remote ? requestedWorktree : undefined,
        signal,
      });
      return await openBlockingReview(
        {
          kind: "diff",
          name: reviewName ?? "Worktree review",
          files: collection.files,
          groups: optionalReviewGroups(args.groups),
          source: collection.source,
        },
        worktree,
        signal,
      );
    }

    if (name === "open_json_review") {
      return await openBlockingReview(
        {
          kind: "diff",
          name: reviewName ?? "JSON review",
          files: jsonReviewFiles(args.files),
          groups: optionalReviewGroups(args.groups),
        },
        cwd,
        signal,
      );
    }

    if (name === "open_document_review") {
      return await openBlockingReview(
        {
          kind: "document",
          name: reviewName ?? "Document review",
          document: {
            markdown: requiredString(args, "markdown"),
            location: optionalString(args, "location"),
          },
        },
        cwd,
        signal,
      );
    }

    if (name === "finish_review") {
      const result = await dependencies.finishReview(cwd, requiredString(args, "reviewPath"));
      const isReviewStillOpen = result.found && result.review.status === "open";
      if (isReviewStillOpen) {
        abortActiveOpen(cwd, result.reviewPath, "Review stopped by finish_review.");
      }
      return result;
    }

    throw new Error(`Unknown LGTM tool: ${name}`);
  };
}

function toolResult(value: unknown) {
  return {
    content: [{ type: "text", text: JSON.stringify(value, null, 2) }],
    structuredContent: value,
  };
}

export async function runMcpServer() {
  const lines = createInterface({ input: process.stdin, crlfDelay: Number.POSITIVE_INFINITY });
  function send(value: unknown) {
    return process.stdout.write(`${JSON.stringify(value)}\n`);
  }
  const server = createMcpMessageHandler(send);

  for await (const line of lines) {
    server.handleLine(line);
  }
  server.close();
}

export function createMcpMessageHandler(
  send: (value: unknown) => void,
  callTool = createMcpToolHandler(),
) {
  const calls = new Map<JsonRpcId, AbortController>();
  function respond(id: JsonRpcId, result: unknown) {
    return send({ jsonrpc: "2.0", id, result });
  }
  function respondError(id: JsonRpcId, code: number, message: string) {
    return send({ jsonrpc: "2.0", id, error: { code, message } });
  }

  function handleLine(line: string) {
    if (!line.trim()) {
      return;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(line) as unknown;
    } catch {
      respondError(null, -32700, "Parse error");
      return;
    }

    if (!isJsonRpcRequest(parsed)) {
      respondError(null, -32600, "Invalid Request");
      return;
    }
    const request = parsed;

    if (request.method === "notifications/initialized") {
      return;
    }
    const isCancellation =
      request.method === "notifications/cancelled" || request.method === "$/cancelRequest";
    if (isCancellation) {
      const id = request.params?.requestId as JsonRpcId | undefined;
      if (id !== undefined) {
        calls.get(id)?.abort(new DOMException("Tool call canceled.", "AbortError"));
      }
      return;
    }
    if (request.id === undefined) {
      return;
    }

    if (request.method === "initialize") {
      respond(request.id, {
        protocolVersion: MCP_PROTOCOL_VERSION,
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: "lgtm", version: "0.1.0" },
      });
      return;
    }
    if (request.method === "ping") {
      respond(request.id, {});
      return;
    }
    if (request.method === "tools/list") {
      respond(request.id, { tools: mcpTools });
      return;
    }
    if (request.method !== "tools/call") {
      respondError(request.id, -32601, `Method not found: ${request.method}`);
      return;
    }

    const id = request.id;
    const toolName = request.params?.name;
    if (typeof toolName !== "string") {
      respondError(id, -32602, "tools/call requires a string name.");
      return;
    }
    const controller = new AbortController();
    calls.set(id, controller);
    void callTool(toolName, request.params?.arguments, controller.signal)
      .then((value) => respond(id, toolResult(value)))
      .catch((error) =>
        respond(id, {
          content: [{ type: "text", text: error instanceof Error ? error.message : String(error) }],
          isError: true,
        }),
      )
      .finally(() => calls.delete(id));
  }

  function close() {
    for (const controller of calls.values()) {
      controller.abort(new DOMException("MCP transport closed.", "AbortError"));
    }
  }

  return { close, handleLine };
}

function isJsonRpcRequest(value: unknown): value is JsonRpcRequest {
  const isInvalidValue = !value || typeof value !== "object" || Array.isArray(value);
  if (isInvalidValue) {
    return false;
  }
  const request = value as Record<string, unknown>;
  const isInvalidEnvelope = request.jsonrpc !== "2.0" || typeof request.method !== "string";
  if (isInvalidEnvelope) {
    return false;
  }
  const isInvalidId =
    request.id !== undefined &&
    request.id !== null &&
    typeof request.id !== "string" &&
    typeof request.id !== "number";
  if (isInvalidId) {
    return false;
  }
  return request.params === undefined || isJsonObject(request.params);
}

function isJsonObject(value: unknown): value is JsonObject {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
