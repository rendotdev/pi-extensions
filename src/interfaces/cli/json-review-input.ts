import { z } from "zod/mini";
import { DomainClass } from "../../domain/domain-class.ts";
import type { DiffReviewFileInput } from "../../domain/review/review.ts";

const fileSchema = z.object({
  location: z.string({ error: "Expected a string." }),
  oldContent: z.string({ error: "Expected a string." }),
  newContent: z.string({ error: "Expected a string." }),
});

const filesSchema = z
  .array(fileSchema)
  .check(z.minLength(1, "JSON review input requires at least one file."));

const jsonReviewObjectSchema = z.object({
  name: z.optional(z.string({ error: "Expected a string." })),
  files: filesSchema,
});

export type JsonReviewInput = {
  name?: string;
  files: DiffReviewFileInput[];
};

export class JsonReviewInputParserClass extends DomainClass<{}, {}> {
  public parse(params: { value: unknown }): JsonReviewInput {
    const result = Array.isArray(params.value)
      ? filesSchema.safeParse(params.value)
      : jsonReviewObjectSchema.safeParse(params.value);
    if (!result.success) {
      const issues = result.error.issues.map(
        (issue) => `${this.formatPath({ path: issue.path })}: ${issue.message}`,
      );
      throw new Error(`Invalid JSON review input:\n${issues.join("\n")}`);
    }

    return Array.isArray(result.data) ? { files: result.data } : result.data;
  }

  private formatPath(params: { path: PropertyKey[] }): string {
    if (params.path.length === 0) return "input";
    return params.path.reduce<string>((path, part) => {
      if (typeof part === "number") return `${path}[${part}]`;
      return path ? `${path}.${String(part)}` : String(part);
    }, "");
  }
}

export const JsonReviewInputParser = new JsonReviewInputParserClass({}, {});
