import { DomainClass } from "../domain-class.ts";

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

export class ReviewHandoffClass extends DomainClass<{}, {}> {
  public clipboardText(params: {
    decision: "approved" | "changes_requested";
    review: HandoffReview;
  }): string {
    const prefix =
      params.decision === "approved"
        ? "LGTM, approving the following changes"
        : "PTAL, requesting the following changes";
    return `${prefix}: ${params.review.reviewPath}`;
  }

  public fallbackText(params: { review: HandoffReview }): string {
    const lines = [
      this.clipboardText({ decision: "changes_requested", review: params.review }),
      "",
      `# ${params.review.name}`,
    ];

    if (params.review.kind === "document") {
      for (const comment of params.review.documentComments) {
        this.appendComment(lines, params.review.document?.location ?? "Document", comment);
      }
    } else {
      for (const file of params.review.files) {
        for (const comment of file.comments) this.appendComment(lines, file.location, comment);
      }
    }

    return `${lines.join("\n").trimEnd()}\n`;
  }

  private appendComment(lines: string[], location: string, comment: HandoffComment) {
    const text = comment.comment.trim();
    if (!text) return;
    const lineRange = this.lineRange(comment.startLine, comment.endLine);
    lines.push("", `## ${location}${lineRange}`, "", text);
    if (comment.selectedText.trim()) {
      lines.push(
        "",
        "Selected text:",
        "",
        "> " + comment.selectedText.trim().replaceAll("\n", "\n> "),
      );
    }
  }

  private lineRange(startLine: number | null, endLine: number | null) {
    if (startLine === null) return "";
    if (endLine === null || endLine === startLine) return `:${startLine}`;
    return `:${startLine}-${endLine}`;
  }
}

export const ReviewHandoff = new ReviewHandoffClass({}, {});
