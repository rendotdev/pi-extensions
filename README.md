<p align="center">
  <img src="https://raw.githubusercontent.com/rendotdev/lgtm/main/assets/logo-text.svg" alt="lgtm" width="320" />
</p>

<p align="center"><strong>Review agent work before you accept it.</strong></p>

LGTM adds a human checkpoint for agentic work by opening a local browser where you can review a diff or document, see exactly what changed, and leave feedback on the relevant lines. Your decision returns to the agent so it can make changes, continue, or stop.

![LGTM reviewing and commenting on a TypeScript diff](https://raw.githubusercontent.com/rendotdev/lgtm/main/assets/lgtm-demo-diff.jpg)

<br />

![LGTM reviewing and commenting on a rendered Markdown implementation plan](https://raw.githubusercontent.com/rendotdev/lgtm/main/assets/lgtm-demo-document.jpg)

## Install

```bash
npm install --global @rendotdev/lgtm
lgtm setup
```

> `lgtm setup` installs the LGTM plugin and skill for Pi, Claude Code, and Codex. To configure one integration only, pass `--target pi`, `--target claude`, or `--target codex`.

## Features

- **Human checkpoints for agent work.** Ask an agent to open a review before it considers work complete.
- **Precise feedback.** Comment on exact lines in Git diffs and rendered Markdown documents.
- **A clear handoff.** Approve, request changes, or cancel, then let the agent continue with your decision.
- **Multiple review sources.** Review the current Git diff, a separate worktree, a Markdown document, and more.
- **Local and remote repositories.** Review a local worktree or read one over SSH while keeping the browser review on your machine.
- **Uses the same tools as you.** Works natively with Pi, Claude Code, and Codex, or use it from the CLI.
- **A fast browser experience.** Escape your terminal and review in an extremely performant web view with side-by-side diffs, line wrapping, file groups, saved preferences, auto-save, virtualization, light and dark modes, and more.

## Development

LGTM uses [Vite+](https://viteplus.dev/), Node, and Bun.

```bash
vp install
vp dev
vp check
vp run package
vp test
bun run demo:images
```

`vp dev` starts the browser app with hot reload and uses the current workspace for its temporary review API. Set `LGTM_DEV_CWD=/path/to/repo` to review another workspace. `bun run demo:images` regenerates the screenshots used in this README.
