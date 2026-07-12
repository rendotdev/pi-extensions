# LGTM

LGTM is a Node CLI for putting a human approval step into agent workflows. It opens code diffs and Markdown documents in a local browser review, then returns either review comments or an explicit LGTM approval.

## CLI

Run LGTM directly with `npx`:

```bash
npx @rendotdev/lgtm git
```

Available commands:

```bash
lgtm git
lgtm worktree ../feature-worktree
lgtm custom --input review.json
lgtm document PLAN.md
lgtm document --name "Implementation plan" < PLAN.md
lgtm finish
lgtm stop
lgtm mcp
```

Add `--json` for machine-readable command output and `--cwd <path>` to choose the review workspace.

Custom reviews accept this JSON shape through `--input` or stdin:

```json
{
  "name": "Authentication changes",
  "files": [
    {
      "location": "src/auth.ts",
      "oldContent": "export const enabled = false;\n",
      "newContent": "export const enabled = true;\n"
    }
  ]
}
```

Every review opens in the browser. **Send comments** completes it with `changes_requested`; **LGTM** completes it with `approved`; **Cancel** completes it with `canceled`. All three actions save the review and stop the local server. Canceling the originating CLI task also stops its server.

## Agent integrations

The published npm package is the shared distribution for Pi, Claude Code, and Codex. It contains the prebuilt CLI and browser app, a shared LGTM skill, both plugin manifests, the Pi extension, and a local MCP server. Installation never needs to build LGTM on the user's machine.

### Pi

After the npm package is published, install it in Pi:

```bash
pi install npm:@rendotdev/lgtm
```

The Pi extension registers:

- `lgtm-open-git-review`
- `lgtm-open-worktree-review`
- `lgtm-open-custom-review`
- `lgtm-open-document-review`
- `lgtm-finish-review`

The package also includes the `lgtm` skill. Invoke it explicitly when you want Pi to preserve the current task context across a human review checkpoint:

```text
/skill:lgtm Review this work before finishing.
```

Load a local checkout directly with:

```bash
pi -e /absolute/path/to/lgtm/src/interfaces/pi/lgtm.ts
```

### Claude Code

LGTM includes a Claude Code plugin manifest, the shared skill, and an MCP configuration. For local development, build the package and load the checkout directly:

```bash
vp run package
claude plugin validate --strict .
claude --plugin-dir .
```

The repository's `.claude-plugin/marketplace.json` exact-pins `@rendotdev/lgtm`. Once that version is published, install from the repository marketplace:

```bash
claude plugin marketplace add https://github.com/rendotdev/lgtm
claude plugin install lgtm@rendotdev
```

### Codex

LGTM includes a Codex plugin manifest, the shared skill, and a Codex-specific MCP configuration. The repository's `.agents/plugins/marketplace.json` exact-pins the same npm package version.

After that version is published, add the marketplace, open `/plugins`, install LGTM, and start a new task:

```bash
codex plugin marketplace add https://github.com/rendotdev/lgtm
codex
```

The MCP server exposes blocking, source-specific review tools. An open tool call waits until the browser review returns `approved`, `changes_requested`, or `canceled`, then stops the local review server and returns the structured result to the agent.

- `open_git_review`
- `open_worktree_review`
- `open_custom_review`
- `open_document_review`
- `finish_review`
- `stop_review`

## Development

LGTM uses [Vite+](https://viteplus.dev/) as its unified project toolchain, Node as its runtime, and npm as its package manager.

```bash
vp install
vp dev
vp check
vp test
vp run package
vp run lgtm --help
npm run metadata:check
```

`vp dev` creates a temporary Git review API for the current workspace and starts Vite with hot reload. Set `LGTM_DEV_CWD=/path/to/repo` to review a different workspace while developing LGTM.

`vp build` creates the reusable browser app in `dist/web`; `vp pack` bundles the Node CLI and Pi adapter. The cached `vp run package` task runs all builds and restores `dist` when its inputs have not changed. Reviews serve this prebuilt frontend, so opening one does not install dependencies or compile a new app.

### Architecture

Application code follows three tiers under `src`:

```text
src/
  interfaces/  CLI, MCP, Pi, and web input and output
  domain/      Review state, rules, formatting, and dependency contracts
  platform/    Git, filesystem, process, HTTP, and browser integration
```

Interfaces and platform code may depend on the domain. Domain code stays independent of both outer tiers. `vite.config.ts` is the development composition root that connects the tiers.

`package.json` is the version source of truth. Run `npm run metadata:sync` after changing it, then commit the synchronized Claude manifest, Codex manifest, and marketplace pins together.

Prepare a semantic release from a clean worktree with one of these commands:

```bash
npm run release:patch
npm run release:minor
npm run release:major
```

The release command runs the full validation pipeline, bumps `package.json` and `package-lock.json`, synchronizes both plugin manifests and marketplace pins, creates a `Release vX.Y.Z` commit, and creates the matching annotated tag. It does not push or publish. Preview the next version without changing anything with `npm run release:patch -- --dry-run`.

## Release artifacts

CI builds and smoke-tests the exact npm tarball without publishing it. A `v<package version>` tag creates a GitHub release containing the validated `.tgz` and its SHA-256 checksum. Publishing that tarball to npm is a separate manual step.
