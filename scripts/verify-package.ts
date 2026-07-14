import { mkdtemp, readFile, rm } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const tarballArgument = process.argv[2];

if (!tarballArgument) {
  throw new Error("Usage: bun scripts/verify-package.ts <package.tgz>");
}

const tarball = resolve(tarballArgument);
const allowedRoots = new Set([
  ".agents",
  ".claude-plugin",
  ".codex-plugin",
  ".mcp.claude.json",
  ".mcp.json",
  "LICENSE",
  "README.md",
  "assets",
  "bin",
  "dist",
  "extensions",
  "package.json",
  "skills",
]);
const requiredPaths = [
  "package/package.json",
  "package/LICENSE",
  "package/README.md",
  "package/.agents/plugins/marketplace.json",
  "package/.claude-plugin/marketplace.json",
  "package/.claude-plugin/plugin.json",
  "package/.codex-plugin/plugin.json",
  "package/.mcp.claude.json",
  "package/.mcp.json",
  "package/bin/lgtm.mjs",
  "package/dist/cli.mjs",
  "package/extensions/index.mjs",
  "package/skills/lgtm/SKILL.md",
];

function run(command: string[]): string {
  const [executable, ...arguments_] = command;
  const result = spawnSync(executable, arguments_, { encoding: "utf8" });

  if (result.status !== 0) {
    throw new Error(`${command.join(" ")} failed:\n${result.stderr.trim()}`);
  }

  return result.stdout;
}

const entries = run(["tar", "-tzf", tarball])
  .split("\n")
  .map((entry) => entry.replace(/\/$/, ""))
  .filter(Boolean);
const entrySet = new Set(entries);

for (const entry of entries) {
  if (!entry.startsWith("package/")) {
    throw new Error(`Unexpected tar entry outside package/: ${entry}`);
  }

  const relativePath = entry.slice("package/".length);
  const root = relativePath.split("/", 1)[0];

  if (root && !allowedRoots.has(root)) {
    throw new Error(`Unexpected published path: ${entry}`);
  }
}

for (const requiredPath of requiredPaths) {
  if (!entrySet.has(requiredPath)) {
    throw new Error(`Required published path is missing: ${requiredPath}`);
  }
}

const extractionDirectory = await mkdtemp(join(tmpdir(), "lgtm-package-"));

try {
  run(["tar", "-xzf", tarball, "-C", extractionDirectory]);

  const packageRoot = join(extractionDirectory, "package");
  const packageJson = JSON.parse(await readFile(join(packageRoot, "package.json"), "utf8")) as {
    bin?: Record<string, string>;
    pi?: { extensions?: string[]; skills?: string[] };
    scripts?: Record<string, string>;
  };

  if (packageJson.bin?.lgtm !== "bin/lgtm.mjs") {
    throw new Error('package.json must map bin.lgtm to "bin/lgtm.mjs"');
  }

  const piExtension = packageJson.pi?.extensions?.[0];
  if (piExtension !== "extensions/index.mjs") {
    throw new Error('package.json pi.extensions must point to "extensions/index.mjs"');
  }
  if (!entrySet.has(`package/${piExtension}`)) {
    throw new Error("package.json pi.extensions must point to a packaged file");
  }

  const piSkill = packageJson.pi?.skills?.[0];
  if (!piSkill || !entrySet.has(`package/${piSkill}`)) {
    const skillHasEntries = piSkill
      ? entries.some((entry) => entry.startsWith(`package/${piSkill}/`))
      : false;

    if (!skillHasEntries) {
      throw new Error("package.json pi.skills must point to packaged skills");
    }
  }

  for (const lifecycleScript of ["preinstall", "install", "postinstall"]) {
    if (packageJson.scripts?.[lifecycleScript]) {
      throw new Error(`Published package must not define ${lifecycleScript}`);
    }
  }
} finally {
  await rm(extractionDirectory, { force: true, recursive: true });
}

console.log(`Verified ${entries.length} entries in ${tarballArgument}`);
