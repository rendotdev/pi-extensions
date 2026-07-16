import { Type } from "@earendil-works/pi-ai";
import {
  defineTool,
  type ExtensionAPI,
  type ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { resolve } from "node:path";
import { DomainClass } from "../../domain/domain-class.ts";
import {
  finishReview,
  openReview,
  stopReviews,
  type OpenReviewOptions,
} from "../../platform/review/review-platform.ts";
import { GitReviewCommand } from "../../platform/review/git-review-command.ts";
import type { OpenReviewInput } from "../../domain/review/review.ts";

const fileInputSchema = Type.Object({
  location: Type.String({ description: "File path or display path." }),
  oldContent: Type.String({ description: "Original file content before the change." }),
  newContent: Type.String({ description: "Updated file content after the change." }),
});

const groupInputSchema = Type.Object(
  {
    title: Type.String({ description: "Short conceptual group title." }),
    files: Type.Array(Type.String(), {
      minItems: 1,
      description: "Changed file paths in review order.",
    }),
  },
  { additionalProperties: false },
);

type LgtmPiExtensionDependencies = {
  collectGitReview: typeof GitReviewCommand.collect;
  finishReview: typeof finishReview;
  openReview: typeof openReview;
  resolvePath: typeof resolve;
  stopReviews: typeof stopReviews;
};

export class LgtmPiExtensionClass extends DomainClass<{}, LgtmPiExtensionDependencies> {
  public register(params: { pi: ExtensionAPI }) {
    const pi = params.pi;
    pi.registerTool(this.createOpenGitReviewTool(pi));
    pi.registerTool(this.createOpenWorktreeReviewTool(pi));
    pi.registerTool(this.createOpenJsonReviewTool(pi));
    pi.registerTool(this.createOpenDocumentReviewTool(pi));
    pi.registerTool(this.createFinishReviewTool());

    pi.on("session_shutdown", async (_event, ctx) => {
      await this.deps.stopReviews(ctx.cwd);
    });
  }

  private reviewOptions(
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
            ? "approved"
            : review.status === "canceled"
              ? "canceled"
              : "returned with review comments";
        const nextStep =
          review.status === "approved"
            ? "The human approved this checkpoint. Complete any outstanding steps from the original request without reopening unchanged work."
            : review.status === "canceled"
              ? "Do not treat this as approval. Preserve the current work and follow the original task only where it remains safe to proceed."
              : "Apply every actionable comment in the context of the original request, validate the revision, and reopen review only if approval is still required.";
        pi.sendUserMessage(
          [
            `The LGTM review "${review.name}" was ${decision}.`,
            "This review result supplements the existing conversation. Preserve the original user goal, constraints, completed work, validation evidence, and remaining steps.",
            nextStep,
            "",
            formattedReview,
          ].join("\n"),
          { deliverAs: "followUp" },
        );
      },
    };
  }

  private async openFromPi(
    pi: ExtensionAPI,
    ctx: ExtensionContext,
    signal: AbortSignal | undefined,
    input: OpenReviewInput,
  ) {
    const pointer = await this.deps.openReview(input, this.reviewOptions(pi, ctx, signal));
    return {
      content: [
        {
          type: "text" as const,
          text: [
            `Opened LGTM review: ${pointer.name}`,
            `URL: ${pointer.url}`,
            `Review JSON: ${pointer.reviewPath}`,
            "Wait for the automatic follow-up from this review before continuing the approval flow.",
          ].join("\n"),
        },
      ],
      details: pointer,
    };
  }

  private createOpenGitReviewTool(pi: ExtensionAPI) {
    return defineTool({
      name: "lgtm-open-git-review",
      label: "Open Git Review",
      description:
        "Open an lgtm browser review for local or SSH-hosted staged, unstaged, and untracked text changes compared with HEAD.",
      promptSnippet:
        "lgtm-open-git-review: Present current Git changes for human review and approval.",
      promptGuidelines: [
        "Use lgtm-open-git-review only after the local or SSH-hosted checkout changes are ready and validated. For SSH, provide remote and an absolute remoteCwd. Provide a concise, task-specific name and wait for its automatic review follow-up before continuing.",
      ],
      executionMode: "sequential",
      parameters: Type.Object({
        name: Type.String({ description: "Concise, task-specific review name." }),
        remote: Type.Optional(
          Type.String({ description: "Optional OpenSSH destination or SSH config alias." }),
        ),
        remoteCwd: Type.Optional(
          Type.String({
            description: "Absolute repository path on the remote machine. Required with remote.",
          }),
        ),
        sinceLast: Type.Optional(
          Type.Boolean({
            description: "Review only changes since the newest compatible completed review.",
          }),
        ),
        groups: Type.Optional(
          Type.Array(groupInputSchema, {
            minItems: 1,
            description: "Conceptual file groups in review order.",
          }),
        ),
      }),
      execute: async (_toolCallId, params, signal, _onUpdate, ctx) => {
        const collection = await this.deps.collectGitReview({
          cwd: ctx.cwd,
          remote: params.remote,
          remoteCwd: params.remoteCwd,
          sessionId: ctx.sessionManager.getSessionId() || undefined,
          signal,
          sinceLast: params.sinceLast,
        });
        return this.openFromPi(pi, ctx, signal, {
          kind: "diff",
          name: params.name,
          files: collection.files,
          groups: params.groups,
          checkpoint: collection.checkpoint,
          source: collection.source,
        });
      },
    });
  }

  private createOpenWorktreeReviewTool(pi: ExtensionAPI) {
    return defineTool({
      name: "lgtm-open-worktree-review",
      label: "Open Worktree Review",
      description: "Open an lgtm browser review for changes in a local or SSH-hosted Git worktree.",
      promptSnippet:
        "lgtm-open-worktree-review: Present another Git worktree for human review and approval.",
      promptGuidelines: [
        "Use lgtm-open-worktree-review for a distinct local worktree path, or provide remote with an absolute remote worktree path; wait for its automatic review follow-up before continuing.",
      ],
      executionMode: "sequential",
      parameters: Type.Object({
        worktree: Type.String({
          description:
            "Local worktree path, or an absolute remote worktree path when remote is provided.",
        }),
        name: Type.Optional(
          Type.String({ description: "Review name. Defaults to Worktree review." }),
        ),
        remote: Type.Optional(
          Type.String({ description: "Optional OpenSSH destination or SSH config alias." }),
        ),
        groups: Type.Optional(
          Type.Array(groupInputSchema, {
            minItems: 1,
            description: "Conceptual file groups in review order.",
          }),
        ),
      }),
      execute: async (_toolCallId, params, signal, _onUpdate, ctx) => {
        const collection = await this.deps.collectGitReview({
          cwd: params.remote ? ctx.cwd : this.deps.resolvePath(ctx.cwd, params.worktree),
          remote: params.remote,
          remoteCwd: params.remote ? params.worktree : undefined,
          signal,
        });
        return this.openFromPi(pi, ctx, signal, {
          kind: "diff",
          name: params.name ?? "Worktree review",
          files: collection.files,
          groups: params.groups,
          source: collection.source,
        });
      },
    });
  }

  private createOpenJsonReviewTool(pi: ExtensionAPI) {
    return defineTool({
      name: "lgtm-open-json-review",
      label: "Open JSON Review",
      description:
        "Open an LGTM browser review from files with location, oldContent, and newContent strings.",
      promptSnippet:
        "lgtm-open-json-review: Present explicit before-and-after file content for human review.",
      promptGuidelines: [
        "Use lgtm-open-json-review for reviewable content that is not represented by the current checkout or another worktree. Every file requires location, oldContent, and newContent strings.",
      ],
      executionMode: "sequential",
      parameters: Type.Object({
        name: Type.String({ description: "Review name." }),
        groups: Type.Optional(
          Type.Array(groupInputSchema, {
            minItems: 1,
            description: "Conceptual file groups in review order.",
          }),
        ),
        files: Type.Array(fileInputSchema, { minItems: 1, description: "Files to review." }),
      }),
      execute: async (_toolCallId, params, signal, _onUpdate, ctx) =>
        this.openFromPi(pi, ctx, signal, {
          kind: "diff",
          name: params.name,
          files: params.files,
          groups: params.groups,
        }),
    });
  }

  private createOpenDocumentReviewTool(pi: ExtensionAPI) {
    return defineTool({
      name: "lgtm-open-document-review",
      label: "Open Document Review",
      description:
        "Render Markdown in an LGTM browser review and collect annotations on selected text.",
      promptSnippet:
        "lgtm-open-document-review: Present Markdown, plans, specifications, prose, or skill drafts for human review.",
      promptGuidelines: [
        "Use lgtm-open-document-review for Markdown-rich work and include a meaningful source location when one exists.",
      ],
      executionMode: "sequential",
      parameters: Type.Object({
        name: Type.String({ description: "Review name." }),
        markdown: Type.String({ description: "Markdown source to render and annotate." }),
        location: Type.Optional(
          Type.String({ description: "Optional source path or document label." }),
        ),
      }),
      execute: async (_toolCallId, params, signal, _onUpdate, ctx) =>
        this.openFromPi(pi, ctx, signal, {
          kind: "document",
          name: params.name,
          document: { markdown: params.markdown, location: params.location },
        }),
    });
  }

  private createFinishReviewTool() {
    return defineTool({
      name: "lgtm-finish-review",
      label: "Finish LGTM Review",
      description:
        "Read a specified LGTM review result. Leave an open review running, or stop its local server after a terminal decision.",
      promptSnippet: "lgtm-finish-review: Recover a specified LGTM result and stop its server.",
      promptGuidelines: [
        "Use lgtm-finish-review with the exact reviewPath only when the user requests it or when a completed review did not return its automatic follow-up.",
      ],
      executionMode: "sequential",
      parameters: Type.Object({
        reviewPath: Type.String({
          description: "review.json path returned when opening the review.",
        }),
      }),
      execute: async (_toolCallId, params, _signal, _onUpdate, ctx) => {
        const result = await this.deps.finishReview(ctx.cwd, params.reviewPath);
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
}

export const LgtmPiExtension = new LgtmPiExtensionClass(
  {},
  {
    collectGitReview: GitReviewCommand.collect.bind(GitReviewCommand),
    finishReview,
    openReview,
    resolvePath: resolve,
    stopReviews,
  },
);

export default function registerLgtmPiExtension(pi: ExtensionAPI) {
  return LgtmPiExtension.register({ pi });
}
