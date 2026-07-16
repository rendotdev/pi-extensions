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
  "package/extensions/index.js",
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

  const isUnexpectedRoot = root && !allowedRoots.has(root);
  if (isUnexpectedRoot) {
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
    name?: string;
    pi?: { extensions?: string[]; skills?: string[] };
    scripts?: Record<string, string>;
    version?: string;
  };
  const codexMcpJson = JSON.parse(await readFile(join(packageRoot, ".mcp.json"), "utf8")) as {
    mcpServers?: { lgtm?: { args?: string[]; command?: string; cwd?: string } };
  };
  const builtCli = await readFile(join(packageRoot, "dist/cli.mjs"), "utf8");
  const packagedSkill = await readFile(join(packageRoot, "skills/lgtm/SKILL.md"), "utf8");
  const packagedPiExtension = await readFile(join(packageRoot, "extensions/index.js"), "utf8");

  const isBuiltCliMissingRemoteReviewSupport =
    !builtCli.includes("--remote-cwd") || !builtCli.includes("SSHGitRepositoryReaderClass");
  if (isBuiltCliMissingRemoteReviewSupport) {
    throw new Error("Packaged CLI must include remote SSH Git review support");
  }

  const isPackagedSkillMissingRemoteReviewSupport =
    !packagedSkill.includes("--remote") || !packagedSkill.includes("remoteCwd");
  if (isPackagedSkillMissingRemoteReviewSupport) {
    throw new Error("Packaged skill must document remote SSH Git reviews");
  }

  const isPackagedPiExtensionMissingRemoteReviewSupport =
    !packagedPiExtension.includes("remoteCwd") ||
    !packagedPiExtension.includes("SSHGitRepositoryReaderClass");
  if (isPackagedPiExtensionMissingRemoteReviewSupport) {
    throw new Error("Packaged Pi extension must include remote SSH Git review support");
  }

  if (packageJson.bin?.lgtm !== "bin/lgtm.mjs") {
    throw new Error('package.json must map bin.lgtm to "bin/lgtm.mjs"');
  }

  const codexMcpServer = codexMcpJson.mcpServers?.lgtm;
  if (codexMcpServer?.command !== "npx") {
    throw new Error('Codex MCP server must use "npx" so source-installed plugins can start.');
  }
  if (codexMcpServer.args?.join(" ") !== `-y ${packageJson.name}@${packageJson.version} mcp`) {
    throw new Error("Codex MCP server must run the current published LGTM package version");
  }
  if (codexMcpServer.cwd !== undefined) {
    throw new Error("Codex MCP server must not depend on a local dist/ directory");
  }

  const piExtension = packageJson.pi?.extensions?.[0];
  if (piExtension !== "extensions/index.js") {
    throw new Error('package.json pi.extensions must point to "extensions/index.js"');
  }
  if (!entrySet.has(`package/${piExtension}`)) {
    throw new Error("package.json pi.extensions must point to a packaged file");
  }
  const piSkill = packageJson.pi?.skills?.[0];
  const isSkillDirectoryMissing = !piSkill || !entrySet.has(`package/${piSkill}`);
  if (isSkillDirectoryMissing) {
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
