import { describe, expect, it, vi } from "vite-plus/test";
import type {
  ExtensionAPI,
  ExtensionContext,
  ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { resolve } from "node:path";
import type { ReviewJson } from "../../domain/review/review.ts";
import type { OpenReviewOptions } from "../../platform/review/review-platform.ts";
import { LgtmPiExtensionClass } from "./lgtm.ts";

describe("LgtmPiExtensionClass", () => {
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
    const extension = new LgtmPiExtensionClass({
      collectGitReviewFiles: vi.fn(async () => []),
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
      stopReviews: vi.fn(async () => false),
    });

    extension.register(pi);

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
    expect(sentMessages[0]?.deliverAs).toBe("followUp");
    expect(sentMessages[0]?.content).toContain("supplements the existing conversation");
    expect(sentMessages[0]?.content).toContain("Preserve the original user goal");
    expect(sentMessages[0]?.content).toContain("Review status: approved");
    expect(finishReview).toHaveBeenCalledWith(
      "/tmp/project",
      ".lgtm/session-1-review-1/review.json",
    );
  });
});
