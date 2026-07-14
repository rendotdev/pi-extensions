import { z } from "zod/mini";

const reviewStatusSchema = z.enum(["open", "approved", "changes_requested", "canceled"]);
const reviewSideSchema = z.enum(["additions", "deletions"]);
const reviewCommentSchema = z.object({
  id: z.string(),
  fileLocation: z.string(),
  selectedRowIds: z.array(z.string()),
  selectedText: z.string(),
  side: reviewSideSchema,
  selectedRange: z.object({
    start: z.number(),
    end: z.number(),
    side: z.optional(reviewSideSchema),
    endSide: z.optional(reviewSideSchema),
  }),
  startLine: z.nullable(z.number()),
  endLine: z.nullable(z.number()),
  lineNumbers: z.array(z.number()),
  comment: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
const reviewFileSchema = z.object({
  location: z.string(),
  added: z.number(),
  removed: z.number(),
  comments: z.array(reviewCommentSchema),
});
const documentSourceSchema = z.object({
  location: z.optional(z.string()),
  markdown: z.string(),
});
const documentCommentSchema = z.object({
  id: z.string(),
  selectedText: z.string(),
  startBlockId: z.string(),
  endBlockId: z.string(),
  startLine: z.number(),
  endLine: z.number(),
  prefix: z.string(),
  suffix: z.string(),
  comment: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const reviewSchema = z.object({
  version: z.literal(2),
  kind: z.enum(["diff", "document"]),
  status: reviewStatusSchema,
  name: z.string(),
  sessionId: z.string(),
  reviewUUID: z.string(),
  reviewId: z.string(),
  sessionUUID: z.optional(z.string()),
  cwd: z.string(),
  appDir: z.string(),
  url: z.optional(z.string()),
  htmlPath: z.optional(z.string()),
  reviewPath: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
  finishedAt: z.optional(z.string()),
  files: z.array(reviewFileSchema),
  document: z.optional(documentSourceSchema),
  documentComments: z.array(documentCommentSchema),
});
export const reviewPayloadSchema = z.object({
  kind: z.enum(["diff", "document"]),
  name: z.string(),
  sessionId: z.string(),
  reviewUUID: z.string(),
  reviewId: z.string(),
  cwd: z.string(),
  appDir: z.string(),
  reviewPath: z.string(),
  generatedAt: z.string(),
  files: z.array(
    z.object({
      id: z.string(),
      location: z.string(),
      language: z.string(),
      oldContent: z.string(),
      newContent: z.string(),
      added: z.number(),
      removed: z.number(),
    }),
  ),
  checkpoint: z.optional(
    z.array(
      z.object({
        location: z.string(),
        content: z.string(),
      }),
    ),
  ),
  document: z.optional(documentSourceSchema),
});
export const reviewManifestSchema = z.object({
  version: z.literal(1),
  reviewId: z.string(),
  createdAt: z.string(),
  expiresAt: z.string(),
});
export const preferencesSchema = z.object({
  diffStyle: z.enum(["unified", "split"]),
  lineWrap: z.boolean(),
  sidebarWidth: z.int().check(z.minimum(192), z.maximum(480)),
});
export const finishRequestSchema = z.object({
  decision: z.enum(["approved", "changes_requested"]),
});
export const healthSchema = z.object({ ok: z.literal(true) });
export const errorSchema = z.object({ error: z.string() });
