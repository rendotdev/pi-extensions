type RecoverableComment = {
  selectedText: string;
  startLine: number | null;
  endLine: number | null;
  comment: string;
};

type RecoverableReview = {
  kind: "diff" | "document";
  name: string;
  reviewPath: string;
  files: Array<{
    location: string;
    comments: RecoverableComment[];
  }>;
  document?: { location?: string };
  documentComments: Array<RecoverableComment>;
};

export class ReviewHandoffClass {
  public recoveryText(review: RecoverableReview) {
    const lines = [`PTAL: ${review.reviewPath}`, "", `# ${review.name}`];

    if (review.kind === "document") {
      for (const comment of review.documentComments) {
        this.appendComment(lines, review.document?.location ?? "Document", comment);
      }
    } else {
      for (const file of review.files) {
        for (const comment of file.comments) this.appendComment(lines, file.location, comment);
      }
    }

    return `${lines.join("\n").trimEnd()}\n`;
  }

  private appendComment(lines: string[], location: string, comment: RecoverableComment) {
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

export const ReviewHandoff = new ReviewHandoffClass();
