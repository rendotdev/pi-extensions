import { describe, expect, it, vi } from "vite-plus/test";
import type {
  ExtensionAPI,
  ExtensionContext,
  ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { resolve } from "node:path";
import type { OpenReviewOptions, ReviewJson } from "../../domains/review/index.ts";
import { LgtmPiExtension } from "./pi.ts";

function expectRegisteredTools(tools: ToolDefinition[]) {
  expect(tools.map((tool) => tool.name)).toEqual([
    "lgtm-open-git-review",
    "lgtm-open-worktree-review",
    "lgtm-open-json-review",
    "lgtm-open-document-review",
    "lgtm-finish-review",
  ]);
  for (const tool of tools) {
    expect(tool.executionMode).toBe("sequential");
    expect(tool.promptSnippet).toContain(tool.name);
    expect(tool.promptGuidelines?.every((guideline) => guideline.includes(tool.name))).toBe(true);
  }
  const openTools = tools.filter((tool) => tool.name.startsWith("lgtm-open-"));
  for (const tool of openTools) {
    expect(tool.promptGuidelines?.join("\n")).toContain(
      "instead of invoking the lgtm CLI through bash",
    );
  }
}

describe("LgtmPiExtension", () => {
  it("registers discoverable sequential tools and returns review results with task context", async () => {
    const tools: ToolDefinition[] = [];
    const sentMessages: Array<{ content: string; deliverAs?: string }> = [];
    let reviewOptions: OpenReviewOptions | undefined;
    const pi = {
      registerTool: (tool: ToolDefinition) => tools.push(tool),
      on: vi.fn(),
      sendUserMessage: (content: string, options?: { deliverAs?: "steer" | "followUp" }) => {
        sentMessages.push({ content, deliverAs: options?.deliverAs });
      },
    } as unknown as ExtensionAPI;
    const finishReview = vi.fn(async () => ({ found: false as const }));
    const Extension = new LgtmPiExtension({
      params: {},
      deps: {
        collectGitReview: vi.fn(async () => ({ files: [] })),
        finishReview,
        openReview: vi.fn(async (_input, options) => {
          reviewOptions = options;
          return {
            name: "Skill draft",
            sessionId: "session-1",
            reviewUUID: "review-1",
            reviewId: "session-1-review-1",
            appDir: "/tmp/project/.lgtm/session-1-review-1",
            url: "http://localhost:12345/",
            reviewPath: "/tmp/project/.lgtm/session-1-review-1/review.json",
          };
        }),
        resolvePath: resolve,
        stopReview: vi.fn(async () => false),
      },
    });

    Extension.register({ pi });

    expectRegisteredTools(tools);

    const gitReviewTool = tools.find((tool) => tool.name === "lgtm-open-git-review");
    expect(gitReviewTool).toBeDefined();
    await gitReviewTool?.execute("tool-call-1", { name: "Skill draft" }, undefined, undefined, {
      cwd: "/tmp/project",
      sessionManager: { getSessionId: () => "session-1" },
    } as unknown as ExtensionContext);

    const approvedReview = {
      status: "approved",
      name: "Skill draft",
    } as ReviewJson;
    await reviewOptions?.onFinished?.(approvedReview, "Review status: approved");

    const finishReviewTool = tools.find((tool) => tool.name === "lgtm-finish-review");
    await finishReviewTool?.execute(
      "tool-call-2",
      { reviewPath: ".lgtm/session-1-review-1/review.json" },
      undefined,
      undefined,
      { cwd: "/tmp/project" } as ExtensionContext,
    );

    expect(sentMessages).toHaveLength(1);
    expect(sentMessages[0]).toEqual({
      content: "Review status: approved",
      deliverAs: "followUp",
    });
    expect(reviewOptions).toEqual(expect.objectContaining({ stopOnAbort: false }));
    expect(finishReview).toHaveBeenCalledWith(
      "/tmp/project",
      ".lgtm/session-1-review-1/review.json",
    );
  });

  it("stops only reviews owned by the shutting down extension", async () => {
    const toolSets: ToolDefinition[][] = [[], []];
    const shutdownHandlers: Array<(event: unknown, ctx: ExtensionContext) => Promise<void>> = [];
    const stopReview = vi.fn(async () => true);
    const Extension = new LgtmPiExtension({
      params: {},
      deps: {
        collectGitReview: vi.fn(async () => ({ files: [] })),
        finishReview: vi.fn(async () => ({ found: false as const })),
        openReview: vi.fn(async (input) => {
          const reviewId = input.name.toLowerCase();
          return {
            name: input.name,
            sessionId: reviewId,
            reviewUUID: "uuid",
            reviewId,
            appDir: `/tmp/project/.lgtm/${reviewId}`,
            url: "http://localhost:12345/",
            reviewPath: `/tmp/project/.lgtm/${reviewId}/review.json`,
          };
        }),
        resolvePath: resolve,
        stopReview,
      },
    });

    function createPi(tools: ToolDefinition[]) {
      return {
        registerTool: function registerTool(tool: ToolDefinition) {
          tools.push(tool);
        },
        on: function on(event: string, handler: unknown) {
          if (event === "session_shutdown") {
            shutdownHandlers.push(
              handler as (event: unknown, ctx: ExtensionContext) => Promise<void>,
            );
          }
        },
        sendUserMessage: vi.fn(),
      } as unknown as ExtensionAPI;
    }

    const context = {
      cwd: "/tmp/project",
      sessionManager: { getSessionId: () => "session" },
    } as unknown as ExtensionContext;
    Extension.register({ pi: createPi(toolSets[0]) });
    Extension.register({ pi: createPi(toolSets[1]) });
    for (const [index, name] of ["alpha", "beta"].entries()) {
      const tool = toolSets[index].find((candidate) => candidate.name === "lgtm-open-json-review");
      await tool?.execute(
        `call-${index}`,
        { name, files: [{ location: "a.ts", oldContent: "", newContent: "a" }] },
        undefined,
        undefined,
        context,
      );
    }

    await shutdownHandlers[0]?.({}, context);

    expect(stopReview).toHaveBeenCalledTimes(1);
    expect(stopReview).toHaveBeenCalledWith("/tmp/project", "/tmp/project/.lgtm/alpha/review.json");
  });

  it("passes remote Git fields through the native Pi tool", async () => {
    const tools: ToolDefinition[] = [];
    const openReview = vi.fn(async () => ({
      name: "Remote",
      sessionId: "session",
      reviewUUID: "uuid",
      reviewId: "session-uuid",
      appDir: "/tmp/project/.lgtm/session-uuid",
      url: "http://localhost:12345/",
      reviewPath: "/tmp/project/.lgtm/session-uuid/review.json",
    }));
    const collectGitReview = vi.fn(async () => ({
      files: [{ location: "remote.ts", oldContent: "old", newContent: "new" }],
      source: {
        kind: "git" as const,
        transport: "ssh" as const,
        key: "ssh://ren@host:22/repo",
        label: "host:/repo",
      },
    }));
    const Extension = new LgtmPiExtension({
      params: {},
      deps: {
        collectGitReview,
        finishReview: vi.fn(async () => ({ found: false as const })),
        openReview,
        resolvePath: resolve,
        stopReview: vi.fn(async () => false),
      },
    });
    Extension.register({
      pi: {
        registerTool: (tool: ToolDefinition) => tools.push(tool),
        on: vi.fn(),
        sendUserMessage: vi.fn(),
      } as unknown as ExtensionAPI,
    });

    const gitReviewTool = tools.find((tool) => tool.name === "lgtm-open-git-review");
    await gitReviewTool?.execute(
      "tool-call",
      {
        name: "Remote",
        remote: "host",
        remoteCwd: "/repo",
        sinceLast: true,
        groups: [{ title: "Runtime", files: ["remote.ts"] }],
      },
      undefined,
      undefined,
      {
        cwd: "/tmp/project",
        sessionManager: { getSessionId: () => "session" },
      } as unknown as ExtensionContext,
    );

    expect(collectGitReview).toHaveBeenCalledWith(
      expect.objectContaining({
        cwd: "/tmp/project",
        remote: "host",
        remoteCwd: "/repo",
        sinceLast: true,
      }),
    );
    expect(openReview).toHaveBeenCalledWith(
      expect.objectContaining({
        groups: [{ title: "Runtime", files: ["remote.ts"] }],
      }),
      expect.anything(),
    );
  });
});
