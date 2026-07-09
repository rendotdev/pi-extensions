# Rendotdev Pi extensions

Rendotdev Pi extensions packaged as a Pi package.

## Install

Install from GitHub:

```bash
pi install git:github.com/rendotdev/pi-extensions
```

Try the package for one Pi session:

```bash
pi -e git:github.com/rendotdev/pi-extensions
```

Install from a local checkout:

```bash
pi install /absolute/path/to/pi-extensions
```

### Install a specific extension

Pi installs git and npm packages at the package level. To load one extension from a package, use package filtering in `~/.pi/agent/settings.json` or project `.pi/settings.json`:

```json
{
  "packages": [
    {
      "source": "git:github.com/rendotdev/pi-extensions",
      "extensions": ["+extensions/pi-diff.ts"],
      "skills": [],
      "prompts": [],
      "themes": []
    }
  ]
}
```

For a local checkout, you can point Pi at a single extension file:

```bash
pi -e /absolute/path/to/pi-extensions/extensions/pi-diff.ts
```

## Package structure

Pi loads resources through the `pi` manifest in `package.json`:

```json
{
  "pi": {
    "extensions": ["./extensions/pi-diff.ts"]
  }
}
```

The manifest lists extension files directly so package filters can target exact extension paths. Files in `extensions/` export Pi extension factories. TypeScript files load directly in Pi, so this package does not need a build step.

## Included extensions

- `extensions/pi-diff.ts`: registers the verb-style `pi-diff-open-review` and `pi-diff-finish-review` tools for browser-based inline pi-diff comments.

## Pi-diff workflow

Ask Pi to call `pi-diff-open-review` with:

```json
{
  "name": "Review name",
  "files": [
    {
      "location": "src/example.ts",
      "oldContent": "const value = 1;\n",
      "newContent": "const value = 2;\n"
    }
  ]
}
```

The tool writes a tiny Bun app:

- `.pi-diff/{piSessionId}-{reviewUUID}/server.ts`
- `.pi-diff/{piSessionId}-{reviewUUID}/src/main.tsx`
- `.pi-diff/{piSessionId}-{reviewUUID}/review.json`

Each review gets its own folder name made from Pi's session ID plus a random review UUID. The generated app uses local npm dependencies only: React, TypeScript, Tailwind, HeroUI, TanStack Form, Lucide icons, and `@pierre/diffs` for diff rendering. The tool runs `bun install`, starts `bun server.ts`, and opens the local review URL in the default browser. Comments save to `review.json` through the local Bun endpoint only when review state changes, so no folder picker is required. Text selections are captured with the Pierre Diffs post-render annotation hook, and line-number selection also works. The UI uses HeroUI Typography, Chip, InputGroup, TextArea, and CloseButton components for text rendering, the comment count, the review path copy control, autoresizing comment entry, and clearing comments; TanStack Form listeners debounce comment saves until typing pauses or the field blurs. HeroUI and Pierre Diffs are normalized to a Vercel-style theme: Geist fonts, black primary controls, and 6px border radius. Review state lives in `review.json`, including `status: "open" | "finished"` and `finishedAt` when applicable. The Send button is disabled until at least one written comment exists; it marks `review.json` as finished, stops the local server, closes the tab when the browser allows it, and asks Pi to continue with the synced review feedback. Starting a new user turn or opening a new review stops the previous local review server, and finishing a review stops its server by default. When reviewing is done without the Send button, ask Pi to finish the review. The model should call `pi-diff-finish-review` to inject the synced comments into context.

## Development

This repo should commit and push with the rendotdev identity. In a local checkout, run:

```bash
git config user.name Ren
git config user.email rpdeshaies+rendotdev@gmail.com
git config core.hooksPath .githooks
git config remote.origin.url git@github-rendotdev:rendotdev/pi-extensions.git
git config remote.origin.pushurl git@github-rendotdev:rendotdev/pi-extensions.git
```

Install dependencies and type-check the package:

```bash
npm install
npm run check
```

Run a dry package check:

```bash
npm run pack:dry
```

Add new extensions as `.ts` files under `extensions/`. If an extension imports Pi core packages, keep them in `peerDependencies` with a `*` range so Pi provides its bundled versions at runtime.
