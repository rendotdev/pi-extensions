import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

type ReleaseType = "patch" | "minor" | "major";

const root = resolve(import.meta.dirname, "..");
const releaseType = process.argv[2] as ReleaseType | undefined;
const dryRun = process.argv.includes("--dry-run");

if (!releaseType || !["patch", "minor", "major"].includes(releaseType)) {
  throw new Error("Usage: bun scripts/release.ts <patch|minor|major> [--dry-run]");
}

const currentVersion = await readPackageVersion();
const nextVersion = incrementVersion(currentVersion, releaseType);
const tag = `v${nextVersion}`;

if (dryRun) {
  console.log(`${releaseType}: ${currentVersion} -> ${nextVersion}`);
  console.log(`Release tag: ${tag}`);
  console.log("Dry run only. No files, commits, tags, pushes, or publications were created.");
  process.exit(0);
}

assertCleanWorktree();
assertTagDoesNotExist(tag);

run("vp", ["check"]);
run("vp", ["run", "package"]);
run("vp", ["test"]);
run("npm", ["version", releaseType, "--no-git-tag-version", "--ignore-scripts"]);
run("npm", ["run", "metadata:sync"]);
run("vp", ["check", "--fix"]);

const bumpedVersion = await readPackageVersion();
if (bumpedVersion !== nextVersion) {
  throw new Error(`Expected package version ${nextVersion}, received ${bumpedVersion}.`);
}

run("npm", ["run", "metadata:check"]);
run("git", [
  "add",
  "package.json",
  "package-lock.json",
  ".agents/plugins/marketplace.json",
  ".claude-plugin/marketplace.json",
  ".claude-plugin/plugin.json",
  ".codex-plugin/plugin.json",
  ".mcp.json",
]);
run("git", ["commit", "-m", `Release ${tag}`]);
run("git", ["tag", "--annotate", tag, "--message", tag]);

console.log(`Prepared ${tag}.`);
console.log("Push the release commit and tag when ready:");
console.log("  git push origin HEAD --follow-tags");
console.log("GitHub Actions will build the release artifact. npm publication remains manual.");

async function readPackageVersion() {
  const packageJson = JSON.parse(await readFile(resolve(root, "package.json"), "utf8")) as {
    version?: unknown;
  };
  if (typeof packageJson.version !== "string") {
    throw new Error("package.json must define a string version.");
  }
  return packageJson.version;
}

export function incrementVersion(version: string, type: ReleaseType) {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
  if (!match) {
    throw new Error(`Expected a stable semantic version, received ${version}.`);
  }

  const major = Number(match[1]);
  const minor = Number(match[2]);
  const patch = Number(match[3]);

  if (type === "major") {
    return `${major + 1}.0.0`;
  }
  if (type === "minor") {
    return `${major}.${minor + 1}.0`;
  }
  return `${major}.${minor}.${patch + 1}`;
}

function assertCleanWorktree() {
  const status = output("git", ["status", "--porcelain"]);
  if (status.trim()) {
    throw new Error("Release preparation requires a clean Git worktree.");
  }
}

function assertTagDoesNotExist(tagName: string) {
  const result = spawnSync("git", ["rev-parse", "--quiet", "--verify", `refs/tags/${tagName}`], {
    cwd: root,
    encoding: "utf8",
  });
  if (result.status === 0) {
    throw new Error(`Git tag ${tagName} already exists.`);
  }
  if (result.status !== 1) {
    throw commandError("git", result.stderr);
  }
}

function run(command: string, arguments_: string[]) {
  console.log(`> ${command} ${arguments_.join(" ")}`);
  const result = spawnSync(command, arguments_, { cwd: root, stdio: "inherit" });
  if (result.status !== 0) {
    throw commandError(command);
  }
}

function output(command: string, arguments_: string[]) {
  const result = spawnSync(command, arguments_, { cwd: root, encoding: "utf8" });
  if (result.status !== 0) {
    throw commandError(command, result.stderr);
  }
  return result.stdout;
}

function commandError(command: string, details?: string) {
  const suffix = details?.trim() ? `: ${details.trim()}` : "";
  return new Error(`${command} failed${suffix}`);
}
