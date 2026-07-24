import type { ReviewComment, ReviewJson } from "../../types/review.ts";

export function formatReview(params: { review: ReviewJson; reviewPath: string }) {
  const lines = formatHeader(params);
  if (params.review.kind === "document") {
    appendDocumentComments({ lines, review: params.review });
  } else {
    appendDiffComments({ lines, review: params.review });
  }
  return lines.join("\n");
}

function formatHeader(params: { review: ReviewJson; reviewPath: string }) {
  const review = params.review;
  const lines = [
    `# ${review.kind === "document" ? "Document" : "Diff"} review: ${review.name}`,
    "",
    `Review JSON: ${params.reviewPath}`,
    `Session: ${review.sessionId ?? review.sessionUUID ?? "unknown"}`,
    `Review ID: ${review.reviewId ?? review.sessionUUID ?? "unknown"}`,
    `Review UUID: ${review.reviewUUID ?? "unknown"}`,
    `Status: ${review.status ?? "open"}`,
  ];
  if (review.finishedAt) {
    lines.push(`Finished: ${review.finishedAt}`);
  }
  if (review.url) {
    lines.push(`Review app URL: ${review.url}`);
  }
  lines.push(`Updated: ${review.updatedAt}`, "");
  return lines;
}

function appendDocumentComments(params: { lines: string[]; review: ReviewJson }) {
  if (params.review.document?.location) {
    params.lines.push(`Document: ${params.review.document.location}`, "");
  }
  const comments = params.review.documentComments.filter((comment) => comment.comment.trim());
  for (const comment of comments) {
    const range =
      comment.startLine === comment.endLine
        ? `Line ${comment.startLine}`
        : `Lines ${comment.startLine}-${comment.endLine}`;
    params.lines.push(
      `## ${range}`,
      "",
      `Selected text: ${truncate(comment.selectedText.trim() || "(none)")}`,
      `Comment: ${comment.comment.trim()}`,
      "",
    );
  }
  if (comments.length === 0) {
    params.lines.push("No written review comments were found.");
  }
}

function appendDiffComments(params: { lines: string[]; review: ReviewJson }) {
  let count = 0;
  for (const file of params.review.files) {
    const comments = file.comments.filter((comment) => comment.comment.trim());
    if (comments.length === 0) {
      continue;
    }
    count += comments.length;
    params.lines.push(`## ${file.location}`, `Changes: +${file.added} -${file.removed}`);
    for (const comment of comments) {
      params.lines.push(
        "",
        `- ${formatLineRange(comment)}`,
        `  Selected text: ${truncate(comment.selectedText.trim() || "(none)")}`,
        `  Comment: ${comment.comment.trim()}`,
      );
    }
    params.lines.push("");
  }
  if (count === 0) {
    params.lines.push("No written review comments were found.");
  }
}

function formatLineRange(comment: ReviewComment) {
  const side = comment.side ? `${comment.side}, ` : "";
  const hasNoLineRange = comment.startLine === null || comment.endLine === null;
  if (hasNoLineRange) {
    return `${side}selected lines`;
  }
  return comment.startLine === comment.endLine
    ? `${side}line ${comment.startLine}`
    : `${side}lines ${comment.startLine}-${comment.endLine}`;
}

function truncate(value: string) {
  return value.length <= 2000 ? value : `${value.slice(0, 2000)}...`;
}
