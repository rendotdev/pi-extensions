import { describe, expect, it, vi } from "vite-plus/test";
import type { ReviewJson, ReviewPointer } from "../../domain/review/review.ts";
import type { CompletedReview } from "../../platform/review/review-platform.ts";
import {
  createMcpMessageHandler,
  createMcpToolHandler,
  mcpTools,
  type McpRuntimeDependencies,
} from "./mcp.ts";

const pointer: ReviewPointer = {
  name: "Review",
  sessionId: "session",
  reviewUUID: "uuid",
  reviewId: "session-uuid",
  appDir: "/tmp/project/.lgtm/session-uuid",
  url: "http://localhost:1234/",
  reviewPath: "/tmp/project/.lgtm/session-uuid/review.json",
};

const review = {
  version: 2,
  kind: "diff",
  status: "changes_requested",
  name: "Review",
  sessionId: "session",
  reviewUUID: "uuid",
  reviewId: "session-uuid",
  cwd: "/tmp/project",
  appDir: pointer.appDir,
  reviewPath: pointer.reviewPath,
  createdAt: "2026-07-11T00:00:00.000Z",
  updatedAt: "2026-07-11T00:00:01.000Z",
  files: [],
  documentComments: [],
} satisfies ReviewJson;

function dependencies(): McpRuntimeDependencies {
  return {
    collectGitReviewFiles: vi.fn(async () => [
      { location: "file.ts", oldContent: "old", newContent: "new" },
    ]),
    finishReview: vi.fn(async () => ({ found: false as const })),
    openReview: vi.fn(async () => pointer),
    stopReview: vi.fn(async () => true),
    waitForReview: vi.fn(
      async () =>
        ({
          reviewPath: pointer.reviewPath,
          review,
          stoppedServer: true,
          formattedReview: "Review status: changes_requested",
        }) satisfies CompletedReview,
    ),
  };
}

function waitUntilAborted() {
  return vi.fn(
    async (_pointer: ReviewPointer, options: { signal?: AbortSignal }): Promise<CompletedReview> =>
      await new Promise<CompletedReview>((_resolve, reject) => {
        const abort = () => reject(options.signal?.reason ?? new Error("Review aborted."));
        options.signal?.addEventListener("abort", abort, { once: true });
        if (options.signal?.aborted) abort();
      }),
  );
}

describe("LGTM MCP tools", () => {
  it("publishes source-specific open tools and lifecycle tools", () => {
    expect(mcpTools.map((tool) => tool.name)).toEqual([
      "open_git_review",
      "open_worktree_review",
      "open_json_review",
      "open_document_review",
      "finish_review",
    ]);
  });

  it("keeps an open Git tool call pending through waitForReview and returns the decision", async () => {
    const runtime = dependencies();
    const handle = createMcpToolHandler(runtime);
    const controller = new AbortController();
    const result = await handle(
      "open_git_review",
      { cwd: "/tmp/project", name: "Agent changes" },
      controller.signal,
    );

    expect(runtime.collectGitReviewFiles).toHaveBeenCalledWith("/tmp/project", controller.signal);
    expect(runtime.openReview).toHaveBeenCalledWith(
      {
        kind: "diff",
        name: "Agent changes",
        files: [{ location: "file.ts", oldContent: "old", newContent: "new" }],
      },
      expect.objectContaining({
        cwd: "/tmp/project",
        signal: expect.any(AbortSignal),
        cleanupOnExit: true,
      }),
    );
    expect(runtime.waitForReview).toHaveBeenCalledWith(pointer, {
      cwd: "/tmp/project",
      signal: expect.any(AbortSignal),
    });
    expect(result).toEqual(expect.objectContaining({ status: "changes_requested" }));
  });

  it("opens JSON and document reviews without a host-specific adapter", async () => {
    const runtime = dependencies();
    const handle = createMcpToolHandler(runtime);
    const signal = new AbortController().signal;

    await handle(
      "open_json_review",
      {
        cwd: "/tmp/project",
        files: [{ location: "new.ts", oldContent: "", newContent: "new" }],
      },
      signal,
    );
    await handle(
      "open_document_review",
      { cwd: "/tmp/project", markdown: "# Draft", location: "draft.md" },
      signal,
    );

    expect(runtime.openReview).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        kind: "diff",
        files: [{ location: "new.ts", oldContent: "", newContent: "new" }],
      }),
      expect.objectContaining({ cwd: "/tmp/project" }),
    );
    expect(runtime.openReview).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        kind: "document",
        document: { markdown: "# Draft", location: "draft.md" },
      }),
      expect.objectContaining({ cwd: "/tmp/project" }),
    );
  });

  it("targets an explicit review when finishing", async () => {
    const runtime = dependencies();
    const handle = createMcpToolHandler(runtime);
    const signal = new AbortController().signal;

    await handle(
      "finish_review",
      { cwd: "/tmp/project", reviewPath: ".lgtm/review/review.json" },
      signal,
    );
    expect(runtime.finishReview).toHaveBeenCalledWith("/tmp/project", ".lgtm/review/review.json");
  });

  it("rejects an overlapping blocking review for the same project", async () => {
    const runtime = dependencies();
    runtime.waitForReview = waitUntilAborted();
    const handle = createMcpToolHandler(runtime);
    const controller = new AbortController();
    const firstReview = handle(
      "open_json_review",
      {
        cwd: "/tmp/project",
        files: [{ location: "first.ts", oldContent: "", newContent: "first" }],
      },
      controller.signal,
    );
    const firstResult = expect(firstReview).rejects.toThrow("test cleanup");
    await vi.waitFor(() => expect(runtime.waitForReview).toHaveBeenCalledOnce());

    await expect(
      handle(
        "open_json_review",
        {
          cwd: "/tmp/project",
          files: [{ location: "second.ts", oldContent: "", newContent: "second" }],
        },
        new AbortController().signal,
      ),
    ).rejects.toThrow("already pending");

    controller.abort(new DOMException("test cleanup", "AbortError"));
    await firstResult;
    expect(runtime.openReview).toHaveBeenCalledOnce();
  });

  it("finish_review terminates a blocking review that is still open", async () => {
    const lifecycleTool = "finish_review";
    const runtime = dependencies();
    runtime.waitForReview = waitUntilAborted();
    runtime.finishReview = vi.fn(async () => ({
      found: true as const,
      reviewPath: pointer.reviewPath,
      review: { ...review, status: "open" as const },
      stoppedServer: true,
      formattedReview: "Review status: open",
    }));
    const handle = createMcpToolHandler(runtime);
    const blockingReview = handle(
      "open_json_review",
      {
        cwd: "/tmp/project",
        files: [{ location: "file.ts", oldContent: "", newContent: "new" }],
      },
      new AbortController().signal,
    );
    const blockingResult = expect(blockingReview).rejects.toThrow(`stopped by ${lifecycleTool}`);
    await vi.waitFor(() => expect(runtime.waitForReview).toHaveBeenCalledOnce());

    await handle(lifecycleTool, { cwd: "/tmp/project" }, new AbortController().signal);

    await blockingResult;
  });
});

describe("LGTM MCP transport", () => {
  it("returns Invalid Request for non-object JSON and continues serving", () => {
    const sent: unknown[] = [];
    const server = createMcpMessageHandler((message) => sent.push(message));

    server.handleLine("null");
    server.handleLine('{"jsonrpc":"2.0","id":1,"method":"ping"}');

    expect(sent).toEqual([
      { jsonrpc: "2.0", id: null, error: { code: -32600, message: "Invalid Request" } },
      { jsonrpc: "2.0", id: 1, result: {} },
    ]);
  });

  it("negotiates the server-supported protocol version", () => {
    const sent: unknown[] = [];
    const server = createMcpMessageHandler((message) => sent.push(message));

    server.handleLine(
      '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"bogus"}}',
    );

    expect(sent).toEqual([
      {
        jsonrpc: "2.0",
        id: 1,
        result: {
          protocolVersion: "2025-06-18",
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: "lgtm", version: "0.1.0" },
        },
      },
    ]);
  });
});
