import { z } from "zod/mini";
import type { DiffReviewFileInput, ReviewGroupInput } from "../../../domains/review/index.ts";

const fileSchema = z.object({
  location: z.string({ error: "Expected a string." }),
  oldContent: z.string({ error: "Expected a string." }),
  newContent: z.string({ error: "Expected a string." }),
});

const filesSchema = z
  .array(fileSchema)
  .check(z.minLength(1, "JSON review input requires at least one file."));

const groupSchema = z.strictObject({
  title: z.string({ error: "Expected a string." }),
  files: z
    .array(z.string({ error: "Expected a string." }))
    .check(z.minLength(1, "Review groups require at least one file.")),
});

const groupsSchema = z
  .array(groupSchema)
  .check(z.minLength(1, "Review grouping requires at least one group."));

const jsonReviewObjectSchema = z.object({
  name: z.optional(z.string({ error: "Expected a string." })),
  files: filesSchema,
  groups: z.optional(groupsSchema),
});

const reviewGroupsObjectSchema = z.strictObject({ groups: groupsSchema });

export type JsonReviewInput = {
  name?: string;
  files: DiffReviewFileInput[];
  groups?: ReviewGroupInput[];
};

function formatPath(params: { path: PropertyKey[] }): string {
  if (params.path.length === 0) {
    return "input";
  }
  return params.path.reduce<string>(function appendPath(path, part) {
    if (typeof part === "number") {
      return `${path}[${part}]`;
    }
    return path ? `${path}.${String(part)}` : String(part);
  }, "");
}

export const JsonReviewInput = {
  parse(params: { value: unknown }): JsonReviewInput {
    const result = Array.isArray(params.value)
      ? filesSchema.safeParse(params.value)
      : jsonReviewObjectSchema.safeParse(params.value);
    if (!result.success) {
      const issues = result.error.issues.map(function formatIssue(issue) {
        return `${formatPath({ path: issue.path })}: ${issue.message}`;
      });
      throw new Error(`Invalid JSON review input:\n${issues.join("\n")}`);
    }
    return Array.isArray(result.data) ? { files: result.data } : result.data;
  },
};

export const ReviewGroupsInput = {
  parse(params: { value: unknown }): ReviewGroupInput[] {
    const result = reviewGroupsObjectSchema.safeParse(params.value);
    if (!result.success) {
      const issues = result.error.issues.map(function formatIssue(issue) {
        return `${formatPath({ path: issue.path })}: ${issue.message}`;
      });
      throw new Error(`Invalid review groups input:\n${issues.join("\n")}`);
    }
    return result.data.groups;
  },
};
