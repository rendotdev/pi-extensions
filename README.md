# Rendotdev Pi extensions

Rendotdev Pi extensions packaged as a Pi package.

## Install

Install pi-diff from GitHub:

```bash
pi install git:github.com/rendotdev/pi-extensions
```

This package currently exposes only `extensions/pi-diff.ts`, so the command above installs the pi-diff extension.

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

