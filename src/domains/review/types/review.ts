export type DiffReviewFileInput = {
  location: string;
  oldContent: string;
  newContent: string;
};

export type ReviewGroupInput = {
  title: string;
  files: string[];
};

export type ReviewGroup = {
  title: string;
  files: string[];
};

export type GitReviewSource = {
  kind: "git";
  transport: "ssh";
  key: string;
  label: string;
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
  source?: GitReviewSource;
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
  groups?: ReviewGroup[];
  checkpoint?: ReviewCheckpointFile[];
  source?: GitReviewSource;
  document?: DocumentSource;
};

export type ReviewCheckpointFile = {
  location: string;
  content: string;
};

export type OpenReviewInput = {
  kind: "diff" | "document";
  name: string;
  files?: DiffReviewFileInput[];
  groups?: ReviewGroupInput[];
  checkpoint?: ReviewCheckpointFile[];
  source?: GitReviewSource;
  document?: DocumentSource;
};

export type ReviewManifest = {
  version: 1;
  reviewId: string;
  createdAt: string;
  expiresAt: string;
};
