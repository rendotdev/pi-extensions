import { defineService } from "../../../../define.ts";

type HandoffComment = {
  selectedText: string;
  startLine: number | null;
  endLine: number | null;
  comment: string;
};

type HandoffReview = {
  kind: "diff" | "document";
  name: string;
  reviewPath: string;
  files: Array<{
    location: string;
    comments: HandoffComment[];
  }>;
  document?: { location?: string };
  documentComments: HandoffComment[];
};

export class ReviewHandoffService extends defineService({
  params: {},
  deps: {},
}) {
  public clipboardText(params: {
    decision: "approved" | "changes_requested";
    review: HandoffReview;
  }): string {
    const prefix =
      params.decision === "approved"
        ? "LGTM, approving the following changes"
        : "PTAL, please address the review comments";
    return `${prefix}: ${params.review.reviewPath}`;
  }

  public fallbackText(params: { review: HandoffReview }): string {
    function lineRange(params: { startLine: number | null; endLine: number | null }) {
      if (params.startLine === null) {
        return "";
      }
      const isSingleLine = params.endLine === null || params.endLine === params.startLine;
      return isSingleLine ? `:${params.startLine}` : `:${params.startLine}-${params.endLine}`;
    }
    function appendComment(params: { lines: string[]; location: string; comment: HandoffComment }) {
      const text = params.comment.comment.trim();
      if (!text) {
        return;
      }
      const range = lineRange({
        startLine: params.comment.startLine,
        endLine: params.comment.endLine,
      });
      params.lines.push("", `## ${params.location}${range}`, "", text);
      if (params.comment.selectedText.trim()) {
        params.lines.push(
          "",
          "Selected text:",
          "",
          "> " + params.comment.selectedText.trim().replaceAll("\n", "\n> "),
        );
      }
    }
    const lines = [
      `PTAL, please address the review comments: ${params.review.reviewPath}`,
      "",
      `# ${params.review.name}`,
    ];
    if (params.review.kind === "document") {
      for (const comment of params.review.documentComments) {
        appendComment({
          lines,
          location: params.review.document?.location ?? "Document",
          comment,
        });
      }
    } else {
      for (const file of params.review.files) {
        for (const comment of file.comments) {
          appendComment({ lines, location: file.location, comment });
        }
      }
    }
    return `${lines.join("\n").trimEnd()}\n`;
  }
}

export const ReviewHandoff = new ReviewHandoffService();
