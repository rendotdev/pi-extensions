# lgtm

> Your agent says the work is done. Take one last look.

LGTM opens your agent's changes in a local browser. You can inspect the diff, comment on exact lines, and either approve the work or send it back with feedback.

It also reviews Markdown. Plans, specifications, documentation, and other prose get the same human checkpoint as code.

## Install

```bash
npm install --global @rendotdev/lgtm
lgtm setup
```

`lgtm setup` adds the LGTM plugin and skill to Pi, Claude Code, and Codex. Set up only one integration with `--target pi`, `--target claude`, or `--target codex`.

## Use it

Review the current Git changes:

```bash
lgtm review --name "Review current changes"
```

`lgtm review git --name "Review current changes"` is the explicit form of the same command.

After addressing review feedback, compare the current working tree with the most recent compatible LGTM diff review that was approved or received change requests:

```bash
lgtm review --since-last --name "Review follow-up changes"
```

LGTM uses the retained review payload as the baseline, so this does not modify Git or create another marker. Open and canceled reviews are ignored. When no compatible completed review exists, it falls back to the normal Git diff.

LGTM opens the review in your browser. Switch between **Unified** and **Side by side** diff layouts, toggle **Line wrap** for long lines, choose **Approve** to approve, **Send comments** to return your feedback, or **Cancel** to stop. The review result is `approved`, `changes_requested`, or `canceled`. Each review has its own server and directory, so agents can review multiple repositories, worktrees, or checkpoints at once. LGTM saves your diff layout, line wrap, and sidebar width preferences in `.lgtm/lgtm.jsonc` at the project root. The agent gets the result and continues from there.

Review source and comments remain available for browser refreshes for seven days. Each review has a hard expiration based on its creation time, including reviews that remain open. LGTM removes expired review files and stops their servers automatically when reviews open and when their expiration timers run; no cleanup command is required.

Other useful commands:

```bash
lgtm review worktree ../feature-worktree --name "Review feature worktree"
lgtm review document PLAN.md --name "Review implementation plan"
lgtm review json review.json --name "Review generated changes"
lgtm review result --review-path .lgtm/<review-id>/review.json
lgtm update
```

JSON reviews use explicit before-and-after file content:

```json
{
  "name": "Review generated changes",
  "files": [
    {
      "location": "src/example.ts",
      "oldContent": "export const answer = 41;",
      "newContent": "export const answer = 42;"
    }
  ]
}
```

`lgtm review result` always requires the exact `Review JSON` path printed when opening a review. It leaves an open review running and stops only that review's server after `approved`, `changes_requested`, or `canceled`: `lgtm review result --review-path .lgtm/<review-id>/review.json`.

`lgtm update` updates the CLI and every installed agent integration. Add `--json` for machine-readable output, `--cwd <path>` to choose another workspace, or `--dry-run` to preview install and update commands.

## Ask your agent

LGTM works best as the final step in an agent task. Try a prompt like this:

```text
Make the change, test it, then run `lgtm review --name "Review current changes"` so I can approve or comment before you finish.
```

The shared skill teaches agents how to open the right review and continue after your decision. The same npm package carries the CLI, browser app, Pi extension, Claude Code plugin, Codex plugin, MCP server, and skill.

## Manual agent setup

Most people only need `lgtm setup`. These commands are here when you want to set up one agent yourself.

### Pi

```bash
pi install npm:@rendotdev/lgtm
```

### Claude Code

```bash
claude plugin marketplace add https://github.com/rendotdev/lgtm
claude plugin install lgtm@rendotdev
```

### Codex

```bash
codex plugin marketplace add rendotdev/lgtm
codex plugin add lgtm@rendotdev
```

Start a new agent session after installing a plugin so it can load LGTM.

## Development

LGTM uses [Vite+](https://viteplus.dev/), Node, and npm.

```bash
vp install
vp dev
vp check
vp run package
vp test
npm run lgtm -- --help
```

`vp dev` starts the browser app with hot reload and uses the current workspace as its temporary review API. Set `LGTM_DEV_CWD=/path/to/repo` to review another workspace.

The code has three tiers:

```text
src/
  interfaces/  CLI, MCP, Pi, and web input and output
  domain/      Review state, rules, formatting, and dependency contracts
  platform/    Git, filesystem, process, HTTP, and browser integration
```

Run `npm run metadata:sync` after changing the package version. To prepare a release, use `npm run release:patch`, `npm run release:minor`, or `npm run release:major`. The release script validates the project, updates plugin metadata, creates the release commit, and adds the matching tag. It leaves pushing and npm publication to you.
