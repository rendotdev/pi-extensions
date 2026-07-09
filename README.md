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

## Pi integration

Install the package in Pi:

```bash
pi install git:github.com/rendotdev/lgtm
```

The Pi extension registers:

- `lgtm-open-git-review`
- `lgtm-open-worktree-review`
- `lgtm-open-custom-review`
- `lgtm-open-document-review`
- `lgtm-finish-review`

Load a local checkout directly with:

```bash
pi -e /absolute/path/to/lgtm/extensions/lgtm.ts
```

The CLI core is independent of Pi so future Codex and Claude integrations can use the same review files, server lifecycle, and approval model.

## Development

LGTM uses [Vite+](https://viteplus.dev/) as its unified project toolchain, Node as its runtime, and npm as its package manager.

```bash
vp install
vp check
vp test
vp run package
vp run lgtm -- --help
```

`vp build` creates the reusable browser app in `dist/web`; `vp pack` bundles the Node CLI. The cached `vp run package` task runs both and restores `dist` when its inputs have not changed. Reviews serve this prebuilt frontend, so opening one does not install dependencies or compile a new app.
