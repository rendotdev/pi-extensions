<p align="center">
  <img src="https://raw.githubusercontent.com/rendotdev/lgtm/main/assets/logo-text.svg" alt="lgtm" width="320" />
</p>

<p align="center"><strong>Review agent work before you accept it.</strong></p>

LGTM gives an agent's work a human checkpoint. It opens a local browser review of a Git diff or Markdown document, lets you leave comments on exact lines, and returns a decision the agent can act on: `approved`, `changes_requested`, or `canceled`.

![lgtm reviewing and commenting on a TypeScript diff](https://raw.githubusercontent.com/rendotdev/lgtm/main/assets/lgtm-demo-diff.jpg)

## Install

```bash
npm install --global @rendotdev/lgtm
lgtm setup
```

`lgtm setup` installs the LGTM plugin and skill for Pi, Claude Code, and Codex. To configure one integration only, pass `--target pi`, `--target claude`, or `--target codex`.

## Review Git changes

Open the current working tree:

```bash
lgtm review --name "Review current changes"
```

Arrange larger reviews into conceptual file groups authored by the agent:

```bash
lgtm review --name "Review current changes" --groups /tmp/lgtm-groups.json
```

```json
{
  "groups": [
    { "title": "Runtime", "files": ["src/runtime.ts"] },
    { "title": "Tests", "files": ["src/runtime.test.ts"] }
  ]
}
```

Group and file order are preserved. Changed files omitted from the manifest remain visible under
**Other changes**.

`lgtm review git --name "Review current changes"` is the equivalent explicit command.

After handling feedback, review only what has changed since the latest compatible completed LGTM diff review:

```bash
lgtm review --since-last --name "Review follow-up changes"
```

The earlier review's retained payload becomes the baseline. LGTM neither changes Git nor adds a marker. Open and canceled reviews are ignored; without a compatible completed review, LGTM falls back to a normal Git diff.

## Review a repository over SSH

Read a working tree from another machine and open the review in the local browser:

```bash
lgtm review git \
  --remote build-mac \
  --remote-cwd /Users/ren/project \
  --name "Review build-mac changes"
```

`--remote` accepts an OpenSSH destination, including an alias from `~/.ssh/config`, `user@host`, or `ssh://user@host:port`. `--remote-cwd` is the absolute repository path on that machine. Remote linked worktrees use the same reader:

```bash
lgtm review worktree /Users/ren/project-feature \
  --remote build-mac \
  --name "Review remote feature worktree"
```

The remote machine needs SSH, Git, and standard POSIX shell utilities. It does not need lgtm, Node, a browser, an exposed port, or writable temporary storage. lgtm runs read-only Git and file commands remotely; the review server, comments, checkpoints, preferences, and decisions stay local.

lgtm uses the system `ssh` executable and inherits SSH aliases, keys, agents, Keychain integration, `SSH_AUTH_SOCK`, `ProxyJump`, and host-key policy. Configure credentials in OpenSSH, then confirm `ssh build-mac true` succeeds before opening the review. Remote `--since-last` baselines match the resolved SSH user, host, port, and Git root.

The bundled MCP `open_git_review` tool accepts `remote`, `remoteCwd`, and `sinceLast`. Its `open_worktree_review` tool accepts `remote` with a remote absolute `path`. Pi's native Git and worktree review tools expose the same fields. Codex, Claude Code, and Pi run SSH locally and return the normal browser decision through their existing review lifecycle.

## Features

- **Unified and side-by-side diffs.** Choose the view that makes a change easiest to assess.
- **Line wrap.** Keep long lines readable without horizontal scrolling.
- **Virtualized rendering.** Keep large reviews responsive while you move between files.
- **Saved preferences.** LGTM stores your chosen layout, line wrapping, sidebar width, and file expansion in `.lgtm/lgtm.jsonc` at the project root.
- **Independent reviews.** Each review has its own server and directory, so reviews for multiple repositories, local or remote worktrees, and checkpoints can stay open at once.

## Work through a review

LGTM opens the review in your browser. Read the diff, add line comments where needed, then approve it, send comments, or cancel. The agent receives that result and can continue from it.

Review source and comments remain available for browser refreshes for seven days. Reviews expire seven days after creation, even if they are still open; LGTM removes their files and stops their servers automatically.

## Review other sources

![lgtm reviewing and commenting on a rendered Markdown implementation plan](https://raw.githubusercontent.com/rendotdev/lgtm/main/assets/lgtm-demo-document.jpg)

```bash
lgtm review worktree ../feature-worktree --name "Review feature worktree"
lgtm review document PLAN.md --name "Review implementation plan"
lgtm review json review.json --name "Review generated changes"
lgtm review result --review-path .lgtm/<review-id>/review.json
lgtm update
```

A JSON review supplies the before and after content directly:

```json
{
  "name": "Review generated changes",
  "groups": [{ "title": "Runtime", "files": ["src/example.ts"] }],
  "files": [
    {
      "location": "src/example.ts",
      "oldContent": "export const answer = 41;",
      "newContent": "export const answer = 42;"
    }
  ]
}
```

`lgtm review result` requires the exact `Review JSON` path printed when the review opens. If that review is still open, the command leaves its server running. Once the result is `approved`, `changes_requested`, or `canceled`, it stops only that review's server.

`lgtm update` updates the CLI and every installed integration. Use `--json` for machine-readable output, `--cwd <path>` for another workspace, or `--dry-run` to see the install and update commands without running them.

## Ask an agent to use LGTM

Request a review after the implementation and tests are complete:

```text
Make the change, test it, then run `lgtm review --name "Review current changes"` so I can approve it or leave comments before you finish.
```

The package includes the CLI, browser app, agent integrations, MCP server, and the shared skill that tells agents which review to open and how to handle its result.

## Manual agent setup

Use these commands only when you want to install an integration yourself instead of running `lgtm setup`.

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

lgtm uses [Vite+](https://viteplus.dev/), Node, and Bun.

```bash
vp install
vp dev
vp check
vp run package
vp test
bun run demo:images
bun run lgtm --help
```

`bun run demo:images` regenerates the light and dark mocked diff and document JPEGs used in this README.

`vp dev` starts the browser app with hot reload and uses the current workspace for its temporary review API. Set `LGTM_DEV_CWD=/path/to/repo` to review another workspace.

The code has three tiers:

```text
src/
  interfaces/  CLI, MCP, Pi, and web input and output
  domain/      Review state, rules, formatting, and dependency contracts
  platform/    Git, filesystem, process, HTTP, and browser integration
```

Run `bun run metadata:sync` after changing the package version. For a release, start from a clean worktree and use `bun run release:patch`, `bun run release:minor`, or `bun run release:major`. The release script validates the project, updates plugin metadata, creates the release commit, and adds the matching tag. Push the release with `git push origin HEAD --follow-tags`. The `v*` tag triggers `.github/workflows/release-artifact.yml`, which publishes to npm through trusted publishing and creates the GitHub release. Never run `npm publish` locally.
