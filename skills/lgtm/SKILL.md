---
name: lgtm
description: Open a local LGTM browser checkpoint so a human can approve agent work or leave contextual comments, then continue the original task from that decision. Use when the user asks for LGTM, PTAL, review, approval, a browser diff, document annotations, or a human checkpoint before completion.
---

# LGTM

LGTM is a local human-review checkpoint for AI-agent work. It renders Git changes or Markdown in a browser, lets the human annotate the exact code or prose that needs attention, and returns approval, requested changes, or cancellation.

## Start here

Prefer the bundled MCP tools when they are available. They keep the tool call open until the human decides, return the structured result directly, and stop the local server:

- `open_git_review`
- `open_worktree_review`
- `open_custom_review`
- `open_document_review`
- `finish_review`
- `stop_review`

Use the matching source-specific open tool after the work is ready and validated. Do not open a duplicate while the human is reviewing.

When MCP tools are unavailable, run `lgtm --help` and use the equivalent CLI command:

Use one command that matches the work being reviewed:

```bash
lgtm git --name "Review current changes"
lgtm worktree ../feature-worktree --name "Review feature worktree"
lgtm document PLAN.md --name "Review implementation plan"
lgtm custom --input review.json --name "Review generated changes"
```

- `git` reviews staged, unstaged, and untracked text changes in the selected checkout.
- `worktree` reviews Git changes in the supplied worktree path.
- `document` reviews a Markdown file. With no file argument, it reads Markdown from stdin.
- `custom` reads explicit before-and-after file content from JSON. Run `lgtm --help` for the current JSON shape.

Add `--cwd <path>` when the review belongs to a different workspace. Add `--json` when another program needs the command result.

## Review workflow

1. Complete a reviewable draft and run proportionate validation.
2. Preserve the original user goal, constraints, completed work, validation evidence, and remaining steps in the current task context.
3. Open one review with the matching MCP tool or CLI command. Do not open a duplicate while the human is reviewing.
4. Give the human the review URL and wait. Keep the review open until they select **LGTM**, **Send comments**, or **Cancel**.
5. Interpret the result in the context of the original task:
   - `LGTM` means the human approved this checkpoint. Complete any remaining requested work without reopening unchanged content.
   - `PTAL: <path>` points to the saved `review.json`. Read that exact file, apply every actionable comment, validate the revision, and reopen when another approval is required.
   - Cancel is not approval. Preserve the work and wait when continuing would require approval.

Use `lgtm finish --cwd <path>` only to recover the latest result when its automatic handoff is missing. Use `lgtm stop --cwd <path>` only when the user asks to stop the review. Never stop an active review as part of unrelated development checks.
