---
name: lgtm
description: Open a local LGTM browser checkpoint so a human can approve agent work or leave contextual comments, then continue the original task from that decision. Use when the user asks for LGTM, `lgtm review`, PTAL, review, approval, a browser diff, document annotations, or a human checkpoint before completion.
---

# LGTM

LGTM is a local human-review checkpoint for AI-agent work. It renders Git changes or Markdown in a browser, lets the human annotate the exact code or prose that needs attention, and returns approval, requested changes, or cancellation.

## Start here

Prefer the bundled MCP tools when they are available. They keep the tool call open until the human decides, return the structured result directly, and stop the local server:

- `open_git_review`
- `open_worktree_review`
- `open_json_review`
- `open_document_review`
- `finish_review`

Use the matching source-specific open tool after the work is ready and validated. Do not open a duplicate while the human is reviewing.

When MCP tools are unavailable, running `lgtm review --name "Review current changes"` is a possible CLI path. Run `lgtm --help`, then use the equivalent command:

Use one command that matches the work being reviewed:

```bash
lgtm review --name "Review current changes"
lgtm review worktree ../feature-worktree --name "Review feature worktree"
lgtm review document PLAN.md --name "Review implementation plan"
lgtm review json review.json --name "Review generated changes"
```

- `git` reviews staged, unstaged, and untracked text changes in the selected checkout.
- `worktree` reviews Git changes in the supplied worktree path.
- `document` reviews a Markdown file. With no file argument, it reads Markdown from stdin.
- `json` reads explicit before-and-after file content. Each file requires `location`, `oldContent`, and `newContent` strings. Run `lgtm --help` for the complete schema.

Add `--cwd <path>` when the review belongs to a different workspace. Add `--json` when another program needs the command result.

## Review workflow

1. Complete a reviewable draft and run proportionate validation.
2. Preserve the original user goal, constraints, completed work, validation evidence, and remaining steps in the current task context.
3. Open one review with the matching MCP tool or CLI command. Do not open a duplicate while the human is reviewing.
4. Give the human the review URL and wait. Keep the review open until they select **Approve**, **Send comments**, or **Cancel**.
5. Interpret the result in the context of the original task:
   - `approved` means the human approved this checkpoint. Complete any remaining requested work without reopening unchanged content.
   - `PTAL: <path>` points to the saved `review.json`. Read that exact file, apply every actionable comment, validate the revision, and reopen when another approval is required.
   - Cancel is not approval. Preserve the work and wait when continuing would require approval.

Use `lgtm review result --review-path <path> --cwd <path>` to recover that exact result and stop only its server when the automatic handoff is missing or the user asks to stop the review. Never read the result of an active review as part of unrelated development checks.
