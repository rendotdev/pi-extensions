import { describe, expect, it } from "vite-plus/test";
import { DemoReview } from "./demo.ts";

describe("DemoReview", () => {
  it("builds a grouped multi-file diff demo", () => {
    const demo = DemoReview.create({ kind: "diff" });

    expect(demo).toMatchObject({
      kind: "diff",
      name: "Demo: Add resilient task retries",
    });
    expect(demo.files).toHaveLength(11);
    expect(demo.files?.map((file) => file.location)).toEqual([
      "src/task-runner.ts",
      "src/retry-policy.ts",
      "src/retry-schedule.ts",
      "src/task-runner.test.ts",
      "src/retry-policy.test.ts",
      "src/retry-schedule.test.ts",
      "src/task-attempt-log.ts",
      "src/task-attempt-log.test.ts",
      "src/task-runner-config.ts",
      "README.md",
      "docs/task-retries.md",
    ]);
    expect(demo.groups).toEqual([
      {
        title: "Implementation",
        files: ["src/task-runner.ts", "src/retry-policy.ts", "src/retry-schedule.ts"],
      },
      {
        title: "Validation",
        files: [
          "src/task-runner.test.ts",
          "src/retry-policy.test.ts",
          "src/retry-schedule.test.ts",
        ],
      },
      {
        title: "Observability",
        files: ["src/task-attempt-log.ts", "src/task-attempt-log.test.ts"],
      },
      { title: "Configuration", files: ["src/task-runner-config.ts"] },
      { title: "Documentation", files: ["README.md", "docs/task-retries.md"] },
    ]);
  });

  it("builds a Markdown-rich document demo", () => {
    const demo = DemoReview.create({ kind: "document" });

    expect(demo).toMatchObject({
      kind: "document",
      name: "Demo: Review a retry plan",
      document: { location: "docs/plans/task-retries.md" },
    });
    expect(demo.document?.markdown).toContain("| Maximum attempts | 3 |");
    expect(demo.document?.markdown).toContain("## Acceptance criteria");
    expect(demo.document?.markdown).toContain("~~~typescript");
    expect(demo.document?.markdown).toContain("~~~diff");
  });

  it("builds realistic comments for both demo kinds", () => {
    const diffComments = DemoReview.createComments({ kind: "diff" });
    const documentComments = DemoReview.createComments({ kind: "document" });

    expect(diffComments.files[0]?.comments[0]?.comment).toContain("jitter");
    expect(documentComments.documentComments[0]?.comment).toContain("next retry time");
  });
});
