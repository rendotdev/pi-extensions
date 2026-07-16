---
name: lgtm
description: Open an lgtm browser review for local or SSH-hosted code and Markdown, wait for a human decision, then continue the task from that result. Use when the user asks for lgtm, `lgtm review`, PTAL, review, approval, a browser diff, document annotations, a remote Git review, or a human checkpoint before completion.
---

# LGTM

LGTM adds a human checkpoint to an agent task. It reviews Git changes, Markdown, or explicit before-and-after content in a local browser. Reviewers can annotate exact lines and return `approved`, `changes_requested`, or `canceled`.

## Open a review

Use the bundled MCP tools when they are available. They wait for the human's decision, return the result directly, and stop the local server when the review reaches a terminal state.

- `open_git_review`
- `open_worktree_review`
- `open_json_review`
- `open_document_review`
- `finish_review`

Choose the tool that matches the source. Open it only after the work is ready and proportionately validated. Do not open another review for the same work while one is active.

For a Git repository on another SSH machine, use `open_git_review` with `remote`, `remoteCwd`, and optional `sinceLast`. For a remote linked worktree, use `open_worktree_review` with `remote` and an absolute remote `path`. SSH runs on the local agent machine through its existing OpenSSH configuration; the remote machine needs Git and standard POSIX shell utilities, not lgtm.

LGTM writes local review state and preferences to `.lgtm/`. Ensure the reviewed repository ignores that directory.

When MCP is unavailable, use the CLI. Run `lgtm --help` first, then choose the matching command:

```bash
lgtm review --name "Review current changes"
lgtm review --name "Review grouped changes" --groups /tmp/lgtm-groups.json
lgtm review --since-last --name "Review follow-up changes"
lgtm review git --remote build-mac --remote-cwd /absolute/repo --name "Review remote changes"
lgtm review worktree ../feature-worktree --name "Review feature worktree"
lgtm review worktree /absolute/remote-worktree --remote build-mac --name "Review remote worktree"
lgtm review document PLAN.md --name "Review implementation plan"
lgtm review json review.json --name "Review generated changes"
```

`--since-last` shows changes since the newest compatible completed Git review that was approved or received changes. It ignores open and canceled reviews.

- `git` reviews staged, unstaged, and untracked text changes in the selected checkout.
- `worktree` reviews changes in the supplied worktree.
- `--remote <destination>` reads Git or worktree changes through the system SSH configuration while keeping the browser, review state, comments, and result local.
- `document` reviews Markdown. Without a path, it reads Markdown from standard input.
- `json` accepts explicit `location`, `oldContent`, and `newContent` fields. Run `lgtm --help` for the full schema.

For a larger diff with distinct concepts, optionally organize the review with groups containing
only a short `title` and an ordered `files` list. Use 2–6 conceptual titles such as Runtime, UI,
Tests, or Documentation. Preserve every changed file; lgtm places omitted files under Other
changes. With MCP, pass `groups` directly to a diff-review tool. With the CLI, write
`{"groups":[...]}` to a temporary JSON file outside the repository and pass `--groups <path>`.

Add `--cwd <path>` for another workspace and `--json` for machine-readable CLI output.

## Handle the decision

1. Keep the user's goal, constraints, completed work, validation, and remaining steps in context.
2. Open one review and give the user its URL. Wait for **Approve**, **Send comments**, or **Cancel**.
3. Act on the result:
   - `approved`: finish any remaining work. Do not reopen unchanged content.
   - `PTAL: <path>`: read that exact `review.json`, address every actionable comment, validate the revision, and open a new review when approval is still needed.
   - `canceled`: preserve the work and wait if continuing requires approval.

If the automatic result is unavailable, recover it with:

```bash
lgtm review result --review-path <path-to-review.json> --cwd <path>
```

That command leaves an active review running. After `approved`, `changes_requested`, or `canceled`, it stops only that review's server. Do not read an active review's result as part of unrelated development work.
