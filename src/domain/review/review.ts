import { DomainClass } from "../domain-class.ts";

export type DiffReviewFileInput = {
  location: string;
  oldContent: string;
  newContent: string;
};

export type ReviewPointer = {
  name: string;
  sessionId: string;
  reviewUUID: string;
  reviewId: string;
  appDir: string;
  url: string;
  reviewPath: string;
};

export type ReviewSourceFile = {
  id: string;
  location: string;
  language: string;
  oldContent: string;
  newContent: string;
  added: number;
  removed: number;
};

export type DocumentSource = {
  location?: string;
  markdown: string;
};

export type DocumentComment = {
  id: string;
  selectedText: string;
  startBlockId: string;
  endBlockId: string;
  startLine: number;
  endLine: number;
  prefix: string;
  suffix: string;
  comment: string;
  createdAt: string;
  updatedAt: string;
};

export type ReviewComment = {
  id: string;
  fileLocation: string;
  selectedRowIds: string[];
  selectedText: string;
  side: "additions" | "deletions";
  selectedRange: {
    start: number;
    end: number;
    side?: "additions" | "deletions";
    endSide?: "additions" | "deletions";
  };
  startLine: number | null;
  endLine: number | null;
  lineNumbers: number[];
  comment: string;
  createdAt: string;
  updatedAt: string;
};

export type ReviewFile = {
  location: string;
  added: number;
  removed: number;
  comments: ReviewComment[];
};

export type ReviewStatus = "open" | "approved" | "changes_requested" | "canceled";

export type ReviewOutcome = Exclude<ReviewStatus, "open">;

export type ReviewJson = {
  version: 2;
  kind: "diff" | "document";
  status: ReviewStatus;
  name: string;
  sessionId: string;
  reviewUUID: string;
  reviewId: string;
  sessionUUID?: string;
  cwd: string;
  appDir: string;
  url?: string;
  htmlPath?: string;
  reviewPath: string;
  createdAt: string;
  updatedAt: string;
  finishedAt?: string;
  files: ReviewFile[];
  document?: DocumentSource;
  documentComments: DocumentComment[];
};

export type ReviewPayload = {
  kind: "diff" | "document";
  name: string;
  sessionId: string;
  reviewUUID: string;
  reviewId: string;
  cwd: string;
  appDir: string;
  reviewPath: string;
  generatedAt: string;
  files: ReviewSourceFile[];
  document?: DocumentSource;
};

export type OpenReviewInput = {
  kind: "diff" | "document";
  name: string;
  files?: DiffReviewFileInput[];
  document?: DocumentSource;
};

export class ReviewSourceBuilderClass extends DomainClass<{}, {}> {
  public build(params: { file: DiffReviewFileInput; index: number }): ReviewSourceFile {
    const counts = this.countChangedLines({
      oldText: params.file.oldContent,
      newText: params.file.newContent,
    });
    return {
      id: `file-${params.index}`,
      location: params.file.location,
      language: this.languageFromPath({ location: params.file.location }),
      oldContent: params.file.oldContent,
      newContent: params.file.newContent,
      added: counts.added,
      removed: counts.removed,
    };
  }

  private countChangedLines(params: { oldText: string; newText: string }) {
    const oldLines = this.splitLines({ value: params.oldText });
    const newLines = this.splitLines({ value: params.newText });
    const cellCount = (oldLines.length + 1) * (newLines.length + 1);
    if (cellCount > 2_000_000) {
      return { added: newLines.length, removed: oldLines.length };
    }

    const width = newLines.length + 1;
    const matrix = new Uint32Array(cellCount);
    for (let oldIndex = oldLines.length - 1; oldIndex >= 0; oldIndex -= 1) {
      for (let newIndex = newLines.length - 1; newIndex >= 0; newIndex -= 1) {
        if (oldLines[oldIndex] === newLines[newIndex]) {
          matrix[oldIndex * width + newIndex] = matrix[(oldIndex + 1) * width + newIndex + 1] + 1;
        } else {
          matrix[oldIndex * width + newIndex] = Math.max(
            matrix[(oldIndex + 1) * width + newIndex],
            matrix[oldIndex * width + newIndex + 1],
          );
        }
      }
    }

    let oldIndex = 0;
    let newIndex = 0;
    let added = 0;
    let removed = 0;
    while (oldIndex < oldLines.length && newIndex < newLines.length) {
      if (oldLines[oldIndex] === newLines[newIndex]) {
        oldIndex += 1;
        newIndex += 1;
      } else if (
        matrix[(oldIndex + 1) * width + newIndex] >= matrix[oldIndex * width + newIndex + 1]
      ) {
        removed += 1;
        oldIndex += 1;
      } else {
        added += 1;
        newIndex += 1;
      }
    }
    removed += oldLines.length - oldIndex;
    added += newLines.length - newIndex;
    return { added, removed };
  }

  private splitLines(params: { value: string }) {
    if (params.value.length === 0) return [];
    return params.value.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
  }

  private languageFromPath(params: { location: string }) {
    const suffixIndex = params.location.lastIndexOf(".");
    const extension = suffixIndex < 0 ? "" : params.location.slice(suffixIndex).toLowerCase();
    const languages: Record<string, string> = {
      ".astro": "astro",
      ".bash": "bash",
      ".c": "c",
      ".cpp": "cpp",
      ".cs": "csharp",
      ".css": "css",
      ".diff": "diff",
      ".go": "go",
      ".graphql": "graphql",
      ".h": "c",
      ".html": "html",
      ".java": "java",
      ".js": "javascript",
      ".json": "json",
      ".jsx": "jsx",
      ".kt": "kotlin",
      ".lua": "lua",
      ".md": "markdown",
      ".mdx": "mdx",
      ".php": "php",
      ".py": "python",
      ".rb": "ruby",
      ".rs": "rust",
      ".scss": "scss",
      ".sh": "bash",
      ".svelte": "svelte",
      ".toml": "toml",
      ".ts": "typescript",
      ".tsx": "tsx",
      ".vue": "vue",
      ".xml": "xml",
      ".yaml": "yaml",
      ".yml": "yaml",
      ".zsh": "bash",
    };
    return languages[extension] ?? "text";
  }
}

export const reviewSourceBuilder = new ReviewSourceBuilderClass({}, {});

export class ReviewBuilderClass extends DomainClass<{}, {}> {
  public build(
    params: Omit<ReviewPayload, "generatedAt"> & {
      generatedAt: string;
      existingReview?: ReviewJson;
    },
  ): ReviewJson {
    const existingByLocation = new Map<string, ReviewFile>();
    for (const file of params.existingReview?.files ?? []) {
      existingByLocation.set(file.location, file);
    }

    return {
      version: 2,
      kind: params.kind,
      status: "open",
      name: params.name,
      sessionId: params.sessionId,
      reviewUUID: params.reviewUUID,
      reviewId: params.reviewId,
      cwd: params.cwd,
      appDir: params.appDir,
      reviewPath: params.reviewPath,
      createdAt: params.existingReview?.createdAt ?? params.generatedAt,
      updatedAt: params.generatedAt,
      files: params.files.map((file) => ({
        location: file.location,
        added: file.added,
        removed: file.removed,
        comments: existingByLocation.get(file.location)?.comments ?? [],
      })),
      document: params.document,
      documentComments: params.existingReview?.documentComments ?? [],
    };
  }
}

export const reviewBuilder = new ReviewBuilderClass({}, {});

export class ReviewFormatterClass extends DomainClass<{}, {}> {
  public format(params: { review: ReviewJson; reviewPath: string }) {
    const { review, reviewPath } = params;
    const lines: string[] = [];
    lines.push(`# ${review.kind === "document" ? "Document" : "Diff"} review: ${review.name}`);
    lines.push("");
    lines.push(`Review JSON: ${reviewPath}`);
    lines.push(`Session: ${review.sessionId ?? review.sessionUUID ?? "unknown"}`);
    lines.push(`Review ID: ${review.reviewId ?? review.sessionUUID ?? "unknown"}`);
    lines.push(`Review UUID: ${review.reviewUUID ?? "unknown"}`);
    lines.push(`Status: ${review.status ?? "open"}`);
    if (review.finishedAt) lines.push(`Finished: ${review.finishedAt}`);
    if (review.url) lines.push(`Review app URL: ${review.url}`);
    lines.push(`Updated: ${review.updatedAt}`);
    lines.push("");

    if (review.kind === "document") {
      if (review.document?.location) lines.push(`Document: ${review.document.location}`, "");
      const comments = review.documentComments.filter(
        (comment) => comment.comment.trim().length > 0,
      );
      for (const comment of comments) {
        const range =
          comment.startLine === comment.endLine
            ? `Line ${comment.startLine}`
            : `Lines ${comment.startLine}-${comment.endLine}`;
        lines.push(`## ${range}`);
        lines.push("");
        lines.push(
          `Selected text: ${this.truncate({ value: comment.selectedText.trim() || "(none)" })}`,
        );
        lines.push(`Comment: ${comment.comment.trim()}`);
        lines.push("");
      }
      if (comments.length === 0) lines.push("No written review comments were found.");
      return lines.join("\n");
    }

    let commentCount = 0;
    for (const file of review.files) {
      lines.push(`## ${file.location}`);
      lines.push(`Changes: +${file.added} -${file.removed}`);

      if (file.comments.length === 0) {
        lines.push("");
        lines.push("No comments for this file.");
        lines.push("");
        continue;
      }

      for (const comment of file.comments) {
        if (comment.comment.trim().length === 0) continue;
        commentCount += 1;
        lines.push("");
        lines.push(`- ${this.formatLineRange({ comment })}`);
        lines.push(
          `  Selected text: ${this.truncate({ value: comment.selectedText.trim() || "(none)" })}`,
        );
        lines.push(`  Comment: ${comment.comment.trim()}`);
      }
      lines.push("");
    }

    if (commentCount === 0) lines.push("No written review comments were found.");
    return lines.join("\n");
  }

  private formatLineRange(params: { comment: ReviewComment }) {
    const { comment } = params;
    const side = comment.side ? `${comment.side}, ` : "";
    if (comment.startLine === null || comment.endLine === null) return `${side}selected lines`;
    if (comment.startLine === comment.endLine) return `${side}line ${comment.startLine}`;
    return `${side}lines ${comment.startLine}-${comment.endLine}`;
  }

  private truncate(params: { value: string }) {
    if (params.value.length <= 2000) return params.value;
    return `${params.value.slice(0, 2000)}...`;
  }
}

export const reviewFormatter = new ReviewFormatterClass({}, {});
