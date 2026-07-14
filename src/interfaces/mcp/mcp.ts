import { createInterface } from "node:readline";
import { resolve } from "node:path";
import {
  collectGitReviewFiles,
  finishReview,
  openReview,
  stopReview,
  waitForReview,
  type OpenReviewOptions,
} from "../../platform/review/review-platform.ts";
import type {
  DiffReviewFileInput,
  OpenReviewInput,
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
  collectGitReviewFiles: typeof collectGitReviewFiles;
  finishReview: typeof finishReview;
  openReview: typeof openReview;
  stopReview: typeof stopReview;
  waitForReview: typeof waitForReview;
};

const defaultDependencies: McpRuntimeDependencies = {
  collectGitReviewFiles,
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

export const mcpTools: McpTool[] = [
  {
    name: "open_git_review",
    description:
      "Open the current Git changes for human review and wait for approval, requested changes, or cancellation.",
    inputSchema: {
      type: "object",
      properties: commonProperties,
      required: ["name"],
      additionalProperties: false,
    },
  },
  {
    name: "open_worktree_review",
    description:
      "Open changes from a specific Git worktree for human review and wait for a decision.",
    inputSchema: {
      type: "object",
      properties: {
        ...commonProperties,
        path: { type: "string", description: "Worktree path, relative to cwd or absolute." },
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
  if (typeof value !== "string" || value.length === 0) {
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

function jsonReviewFiles(value: unknown): DiffReviewFileInput[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error("files must be a non-empty array.");
  }
  return value.map((entry, index) => {
    if (!entry || typeof entry !== "object") {
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
    if (reviewPath && activeOpen.reviewPath !== reviewPath) {
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
      const files = await dependencies.collectGitReviewFiles(cwd, signal);
      return await openBlockingReview(
        { kind: "diff", name: requiredString(args, "name"), files },
        cwd,
        signal,
      );
    }

    if (name === "open_worktree_review") {
      const worktree = resolve(cwd, requiredString(args, "path"));
      const files = await dependencies.collectGitReviewFiles(worktree, signal);
      return await openBlockingReview(
        { kind: "diff", name: reviewName ?? "Worktree review", files },
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
      if (result.found && result.review.status === "open") {
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
    if (request.method === "notifications/cancelled" || request.method === "$/cancelRequest") {
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
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const request = value as Record<string, unknown>;
  if (request.jsonrpc !== "2.0" || typeof request.method !== "string") {
    return false;
  }
  if (
    request.id !== undefined &&
    request.id !== null &&
    typeof request.id !== "string" &&
    typeof request.id !== "number"
  ) {
    return false;
  }
  return request.params === undefined || isJsonObject(request.params);
}

function isJsonObject(value: unknown): value is JsonObject {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
