import { Type } from "@earendil-works/pi-ai";
import {
  defineTool,
  type ExtensionAPI,
  type ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { resolve } from "node:path";
import {
  collectGitReviewFiles,
  finishReview,
  openReview,
  stopReviews,
  type OpenReviewInput,
  type OpenReviewOptions,
} from "../src/core.ts";

const fileInputSchema = Type.Object({
  location: Type.String({ description: "File path or display path." }),
  oldContent: Type.String({ description: "Original file content before the change." }),
  newContent: Type.String({ description: "Updated file content after the change." }),
});

function reviewOptions(
  pi: ExtensionAPI,
  ctx: ExtensionContext,
  signal?: AbortSignal,
): OpenReviewOptions {
  return {
    cwd: ctx.cwd,
    sessionId: ctx.sessionManager.getSessionId() || undefined,
    signal,
    cleanupOnExit: true,
    onFinished: async (review, formattedReview) => {
      const decision =
        review.status === "approved"
          ? "approved with LGTM"
          : review.status === "canceled"
            ? "canceled"
            : "returned with review comments";
      pi.sendUserMessage(
        [
          `The browser LGTM review was ${decision}. Continue using the synced result below.`,
          "",
          formattedReview,
        ].join("\n"),
        { deliverAs: "followUp" },
      );
    },
  };
}

async function openFromPi(
  pi: ExtensionAPI,
  ctx: ExtensionContext,
  signal: AbortSignal | undefined,
  input: OpenReviewInput,
) {
  const pointer = await openReview(input, reviewOptions(pi, ctx, signal));
  return {
    content: [
      {
        type: "text" as const,
        text: [
          `Opened LGTM review: ${pointer.name}`,
          `URL: ${pointer.url}`,
          `Review JSON: ${pointer.reviewPath}`,
          "The reviewer can send comments, approve with LGTM, or cancel the review.",
        ].join("\n"),
      },
    ],
    details: pointer,
  };
}

function createOpenGitReviewTool(pi: ExtensionAPI) {
  return defineTool({
    name: "lgtm-open-git-review",
    label: "Open Git Review",
    description:
      "Open an LGTM browser review for current staged, unstaged, and untracked text changes compared with HEAD.",
    parameters: Type.Object({
      name: Type.Optional(Type.String({ description: "Review name. Defaults to Git review." })),
    }),
    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      const files = await collectGitReviewFiles(ctx.cwd, signal);
      return openFromPi(pi, ctx, signal, {
        kind: "diff",
        name: params.name ?? "Git review",
        files,
      });
    },
  });
}

function createOpenWorktreeReviewTool(pi: ExtensionAPI) {
  return defineTool({
    name: "lgtm-open-worktree-review",
    label: "Open Worktree Review",
    description: "Open an LGTM browser review for changes in another Git worktree.",
    parameters: Type.Object({
      worktree: Type.String({
        description:
          "Absolute path, or path relative to the current working directory, of the worktree.",
      }),
      name: Type.Optional(
        Type.String({ description: "Review name. Defaults to Worktree review." }),
      ),
    }),
    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      const files = await collectGitReviewFiles(resolve(ctx.cwd, params.worktree), signal);
      return openFromPi(pi, ctx, signal, {
        kind: "diff",
        name: params.name ?? "Worktree review",
        files,
      });
    },
  });
}

function createOpenCustomReviewTool(pi: ExtensionAPI) {
  return defineTool({
    name: "lgtm-open-custom-review",
    label: "Open Custom Review",
    description:
      "Open an LGTM browser review from explicitly supplied original and updated file contents.",
    parameters: Type.Object({
      name: Type.String({ description: "Review name." }),
      files: Type.Array(fileInputSchema, { minItems: 1, description: "Files to review." }),
    }),
    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      return openFromPi(pi, ctx, signal, { kind: "diff", name: params.name, files: params.files });
    },
  });
}

function createOpenDocumentReviewTool(pi: ExtensionAPI) {
  return defineTool({
    name: "lgtm-open-document-review",
    label: "Open Document Review",
    description:
      "Render Markdown in an LGTM browser review and collect annotations on selected text.",
    parameters: Type.Object({
      name: Type.String({ description: "Review name." }),
      markdown: Type.String({ description: "Markdown source to render and annotate." }),
      location: Type.Optional(
        Type.String({ description: "Optional source path or document label." }),
      ),
    }),
    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      return openFromPi(pi, ctx, signal, {
        kind: "document",
        name: params.name,
        document: { markdown: params.markdown, location: params.location },
      });
    },
  });
}

function createFinishReviewTool() {
  return defineTool({
    name: "lgtm-finish-review",
    label: "Finish LGTM Review",
    description: "Read the active or latest LGTM review result and always stop its local server.",
    parameters: Type.Object({}),
    async execute(_toolCallId, _params, _signal, _onUpdate, ctx) {
      const result = await finishReview(ctx.cwd);
      if (!result.found) {
        return {
          content: [{ type: "text" as const, text: "No LGTM review was found." }],
          details: result,
        };
      }
      return {
        content: [
          {
            type: "text" as const,
            text: `${result.formattedReview}\n\nRaw review.json:\n\n\`\`\`json\n${JSON.stringify(result.review, null, 2)}\n\`\`\``,
          },
        ],
        details: result,
      };
    },
  });
}

export default function lgtmExtension(pi: ExtensionAPI) {
  pi.registerTool(createOpenGitReviewTool(pi));
  pi.registerTool(createOpenWorktreeReviewTool(pi));
  pi.registerTool(createOpenCustomReviewTool(pi));
  pi.registerTool(createOpenDocumentReviewTool(pi));
  pi.registerTool(createFinishReviewTool());

  pi.on("session_shutdown", async (_event, ctx) => {
    await stopReviews(ctx.cwd);
  });
}
