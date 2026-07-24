import { describe, expect, it, vi } from "vite-plus/test";
import type { ReviewPointer } from "../../domains/review/index.ts";
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

function dependencies(): McpRuntimeDependencies {
  return {
    collectGitReview: vi.fn(async () => ({
      files: [{ location: "file.ts", oldContent: "old", newContent: "new" }],
    })),
    finishReview: vi.fn(async () => ({ found: false as const })),
    openReview: vi.fn(async () => pointer),
  };
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
    expect(mcpTools.find((tool) => tool.name === "finish_review")?.inputSchema).toEqual(
      expect.objectContaining({ required: ["reviewPath"] }),
    );
    expect(mcpTools.find((tool) => tool.name === "open_git_review")?.inputSchema).toEqual(
      expect.objectContaining({
        required: ["name"],
        properties: expect.objectContaining({
          groups: expect.objectContaining({ minItems: 1 }),
        }),
      }),
    );
  });

  it("passes title-and-file groups to Git reviews", async () => {
    const runtime = dependencies();
    const handle = createMcpToolHandler(runtime);
    const groups = [{ title: "Runtime", files: ["file.ts"] }];

    await handle(
      "open_git_review",
      { cwd: "/tmp/project", name: "Grouped changes", groups },
      new AbortController().signal,
    );

    expect(runtime.openReview).toHaveBeenCalledWith(
      expect.objectContaining({ groups }),
      expect.anything(),
    );
  });

  it("rejects unsupported group metadata", async () => {
    const runtime = dependencies();
    const handle = createMcpToolHandler(runtime);

    await expect(
      handle(
        "open_git_review",
        {
          cwd: "/tmp/project",
          name: "Grouped changes",
          groups: [{ title: "Runtime", summary: "Not supported", files: ["file.ts"] }],
        },
        new AbortController().signal,
      ),
    ).rejects.toThrow("unsupported fields: summary");
  });

  it("returns an open Git review immediately with a transport-independent lifecycle", async () => {
    const runtime = dependencies();
    const handle = createMcpToolHandler(runtime);
    const controller = new AbortController();
    const result = await handle(
      "open_git_review",
      { cwd: "/tmp/project", name: "Agent changes" },
      controller.signal,
    );

    expect(runtime.collectGitReview).toHaveBeenCalledWith(
      expect.objectContaining({ cwd: "/tmp/project", signal: controller.signal }),
    );
    expect(runtime.openReview).toHaveBeenCalledWith(
      {
        kind: "diff",
        name: "Agent changes",
        files: [{ location: "file.ts", oldContent: "old", newContent: "new" }],
      },
      expect.objectContaining({
        cwd: "/tmp/project",
        signal: controller.signal,
        stopOnAbort: false,
        cleanupOnExit: false,
      }),
    );
    expect(result).toEqual({ status: "open", ...pointer });
  });

  it("passes remote Git arguments and source metadata through the existing tool", async () => {
    const runtime = dependencies();
    runtime.collectGitReview = vi.fn(async () => ({
      files: [{ location: "remote.ts", oldContent: "old", newContent: "new" }],
      source: {
        kind: "git" as const,
        transport: "ssh" as const,
        key: "ssh://ren@host:22/repo",
        label: "devbox:/repo",
      },
    }));
    const handle = createMcpToolHandler(runtime);

    await handle(
      "open_git_review",
      {
        cwd: "/tmp/project",
        name: "Remote changes",
        remote: "devbox",
        remoteCwd: "/repo",
        sinceLast: true,
      },
      new AbortController().signal,
    );

    expect(runtime.collectGitReview).toHaveBeenCalledWith(
      expect.objectContaining({
        cwd: "/tmp/project",
        remote: "devbox",
        remoteCwd: "/repo",
        sinceLast: true,
      }),
    );
    expect(runtime.openReview).toHaveBeenCalledWith(
      expect.objectContaining({
        source: expect.objectContaining({ transport: "ssh" }),
      }),
      expect.anything(),
    );
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

  it("requires a review path when finishing", async () => {
    const runtime = dependencies();
    const handle = createMcpToolHandler(runtime);

    await expect(
      handle("finish_review", { cwd: "/tmp/project" }, new AbortController().signal),
    ).rejects.toThrow("reviewPath is required");
    expect(runtime.finishReview).not.toHaveBeenCalled();
  });

  it("does not keep MCP state that blocks a later review in the same project", async () => {
    const runtime = dependencies();
    const handle = createMcpToolHandler(runtime);
    await handle(
      "open_json_review",
      {
        cwd: "/tmp/project",
        files: [{ location: "first.ts", oldContent: "", newContent: "first" }],
      },
      new AbortController().signal,
    );
    await handle(
      "open_json_review",
      {
        cwd: "/tmp/project",
        files: [{ location: "second.ts", oldContent: "", newContent: "second" }],
      },
      new AbortController().signal,
    );

    expect(runtime.openReview).toHaveBeenCalledTimes(2);
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
