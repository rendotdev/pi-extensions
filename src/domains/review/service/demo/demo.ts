import { defineService } from "../../../../define.ts";
import type { DocumentComment, OpenReviewInput, ReviewComment } from "../../types/review.ts";

export type DemoReviewKind = "diff" | "document";
export type DemoReviewComments = {
  files: { location: string; comments: ReviewComment[] }[];
  documentComments: DocumentComment[];
};

export class DemoReviewService extends defineService({
  params: {},
  deps: {},
}) {
  public create(params: { kind: DemoReviewKind }): OpenReviewInput {
    return structuredClone(params.kind === "document" ? documentReview : diffReview);
  }

  public createComments(params: { kind: DemoReviewKind }): DemoReviewComments {
    return params.kind === "document" ? createDocumentComments() : createDiffComments();
  }
}

const diffReview: OpenReviewInput = {
  kind: "diff",
  name: "Demo: Add resilient task retries",
  groups: [
    {
      title: "Implementation",
      files: ["src/task-runner.ts", "src/retry-policy.ts", "src/retry-schedule.ts"],
    },
    {
      title: "Validation",
      files: ["src/task-runner.test.ts", "src/retry-policy.test.ts", "src/retry-schedule.test.ts"],
    },
    {
      title: "Observability",
      files: ["src/task-attempt-log.ts", "src/task-attempt-log.test.ts"],
    },
    { title: "Configuration", files: ["src/task-runner-config.ts"] },
    { title: "Documentation", files: ["README.md", "docs/task-retries.md"] },
  ],
  files: [
    {
      location: "src/task-runner.ts",
      oldContent: `export async function runTask(task: Task, deps: Dependencies) {
  const result = await deps.execute(task);
  return result;
}
`,
      newContent: `export async function runTask(task: Task, deps: Dependencies) {
  const maximumAttempts = 3;

  for (let attempt = 1; attempt <= maximumAttempts; attempt += 1) {
    try {
      return await deps.execute(task);
    } catch (error) {
      if (attempt === maximumAttempts) {
        throw error;
      }

      const delay = 250 * 2 ** (attempt - 1);
      await deps.wait(delay);
    }
  }

          throw new Error("Task retry loop finished unexpectedly.");
}
`,
    },
    {
      location: "src/retry-policy.ts",
      oldContent: `export const retryPolicy = {
  maximumAttempts: 1,
};
`,
      newContent: `export const retryPolicy = {
  maximumAttempts: 3,
  initialDelay: 250,
  backoff: 2,
};
`,
    },
    {
      location: "src/retry-schedule.ts",
      oldContent: `export function retryDelay() {
  return 0;
}
`,
      newContent: `export function retryDelay(attempt: number) {
  return 250 * 2 ** (attempt - 1);
}
`,
    },
    {
      location: "src/task-runner.test.ts",
      oldContent: `it("runs a task", async () => {
  const result = await runTask(task, dependencies);
  expect(result).toEqual({ status: "complete" });
});
`,
      newContent: `it("retries a failed task with exponential backoff", async () => {
  const execute = vi
    .fn()
    .mockRejectedValueOnce(new Error("Temporary failure"))
    .mockResolvedValue({ status: "complete" });
  const wait = vi.fn().mockResolvedValue(undefined);

  const result = await runTask(task, { execute, wait });

  expect(result).toEqual({ status: "complete" });
  expect(execute).toHaveBeenCalledTimes(2);
  expect(wait).toHaveBeenCalledWith(250);
});
`,
    },
    {
      location: "src/retry-policy.test.ts",
      oldContent: `it("runs tasks once", () => {
  expect(retryPolicy.maximumAttempts).toBe(1);
});
`,
      newContent: `it("allows three attempts", () => {
  expect(retryPolicy.maximumAttempts).toBe(3);
  expect(retryPolicy.backoff).toBe(2);
});
`,
    },
    {
      location: "src/retry-schedule.test.ts",
      oldContent: `it("does not delay retries", () => {
  expect(retryDelay()).toBe(0);
});
`,
      newContent: `it("uses exponential backoff", () => {
  expect(retryDelay(1)).toBe(250);
  expect(retryDelay(2)).toBe(500);
});
`,
    },
    {
      location: "src/task-attempt-log.ts",
      oldContent: `export type TaskAttemptLog = {
  taskId: string;
  status: "failed" | "complete";
};
`,
      newContent: `export type TaskAttemptLog = {
  taskId: string;
  attempt: number;
  status: "retrying" | "failed" | "complete";
  retryAt?: string;
};
`,
    },
    {
      location: "src/task-attempt-log.test.ts",
      oldContent: `it("records task completion", () => {
  expect(taskLog.status).toBe("complete");
});
`,
      newContent: `it("records the scheduled retry", () => {
  expect(taskLog).toMatchObject({ attempt: 2, status: "retrying" });
  expect(taskLog.retryAt).toBeDefined();
});
`,
    },
    {
      location: "src/task-runner-config.ts",
      oldContent: `export const taskRunnerConfig = {
  maximumAttempts: 1,
};
`,
      newContent: `export const taskRunnerConfig = {
  maximumAttempts: Number(process.env.TASK_MAXIMUM_ATTEMPTS ?? 3),
};
`,
    },
    {
      location: "README.md",
      oldContent: `## Task execution

Tasks run once and report their result.
`,
      newContent: `## Task execution

Tasks retry temporary failures up to three times. Retries use exponential
backoff, starting at 250 milliseconds, before reporting the final result.
`,
    },
    {
      location: "docs/task-retries.md",
      oldContent: `# Task retries

Tasks report failures immediately.
`,
      newContent: `# Task retries

Temporary failures retry up to three times with exponential backoff. The task
log shows the current attempt and the next scheduled retry.
`,
    },
  ],
};

const documentReview: OpenReviewInput = {
  kind: "document",
  name: "Demo: Review a retry plan",
  document: {
    location: "docs/plans/task-retries.md",
    markdown: `# Resilient task retries

## Goal

Allow task execution to recover from temporary failures while keeping permanent failures visible and actionable.

## User experience

When a task fails, the runner retries it automatically. The interface shows the current attempt and preserves the final error if every attempt fails.

| Setting | Default | Purpose |
| --- | ---: | --- |
| Maximum attempts | 3 | Limits repeated work |
| Initial delay | 250 ms | Gives temporary failures time to recover |
| Backoff | 2x | Reduces pressure on dependencies |

## Implementation

1. Add retry orchestration around the task executor.
2. Inject the wait boundary so tests remain deterministic.
3. Preserve the original error after the final attempt.

### Retry policy

~~~typescript
export const retryPolicy = {
  maximumAttempts: 3,
  initialDelay: 250,
  backoff: 2,
};
~~~

### Proposed change

~~~diff
-const maximumAttempts = 1;
+const maximumAttempts = 3;
~~~

## Acceptance criteria

- Successful tasks still execute once.
- Temporary failures retry with exponential backoff.
`,
  },
};

const demoTimestamp = "2026-07-15T12:00:00.000Z";

function createDocumentComments(): DemoReviewComments {
  return {
    files: [],
    documentComments: [
      {
        id: "demo-document-comment",
        selectedText:
          "When a task fails, the runner retries it automatically. The interface shows the current attempt and preserves the final error if every attempt fails.",
        startBlockId: "p:9:9",
        endBlockId: "p:9:9",
        startLine: 9,
        endLine: 9,
        prefix: "",
        suffix: "",
        comment: "Could we show the next retry time so users know the task is still active?",
        createdAt: demoTimestamp,
        updatedAt: demoTimestamp,
      },
    ],
  };
}

function createDiffComments(): DemoReviewComments {
  return {
    files: [
      {
        location: "src/task-runner.ts",
        comments: [
          {
            id: "demo-diff-comment",
            fileLocation: "src/task-runner.ts",
            selectedRowIds: ["additions:12-12"],
            selectedText: "const delay = 250 * 2 ** (attempt - 1);",
            side: "additions",
            selectedRange: {
              start: 12,
              end: 12,
              side: "additions",
              endSide: "additions",
            },
            startLine: 12,
            endLine: 12,
            lineNumbers: [12],
            comment: "Could we add jitter so concurrent retries do not synchronize?",
            createdAt: demoTimestamp,
            updatedAt: demoTimestamp,
          },
        ],
      },
    ],
    documentComments: [],
  };
}

export const DemoReview = new DemoReviewService();
