import { resolve } from "node:path";
import { readFile, writeFile } from "node:fs/promises";

type JsonObject = Record<string, unknown>;

const root = resolve(import.meta.dirname, "..");
const checkOnly = process.argv.includes("--check");

async function readJson(path: string): Promise<JsonObject> {
  return JSON.parse(await readFile(resolve(root, path), "utf8")) as JsonObject;
}

const packageJson = await readJson("package.json");
const packageName = packageJson.name;
const packageVersion = packageJson.version;

if (typeof packageName !== "string" || typeof packageVersion !== "string") {
  throw new Error("package.json must define string name and version fields.");
}

const updates: Array<{ path: string; update: (json: JsonObject) => void }> = [
  {
    path: ".claude-plugin/plugin.json",
    update: (json) => {
      json.version = packageVersion;
    },
  },
  {
    path: ".codex-plugin/plugin.json",
    update: (json) => {
      json.version = packageVersion;
    },
  },
  {
    path: ".claude-plugin/marketplace.json",
    update: (json) => updateNpmMarketplace(json, packageName, packageVersion, true),
  },
  {
    path: ".agents/plugins/marketplace.json",
    update: (json) => updateLocalMarketplace(json),
  },
];

const changed: string[] = [];

for (const entry of updates) {
  const json = await readJson(entry.path);
  const before = `${JSON.stringify(json, null, 2)}\n`;
  entry.update(json);
  const after = `${JSON.stringify(json, null, 2)}\n`;
  if (before === after) {
    continue;
  }
  changed.push(entry.path);
  if (!checkOnly) {
    await writeFile(resolve(root, entry.path), after);
  }
}

if (checkOnly && changed.length > 0) {
  throw new Error(
    `Plugin metadata is out of sync: ${changed.join(", ")}. Run npm run metadata:sync.`,
  );
}

if (changed.length === 0) {
  console.log(`Plugin metadata matches ${packageName}@${packageVersion}.`);
} else {
  console.log(`Updated ${changed.join(", ")} to ${packageName}@${packageVersion}.`);
}

function updateNpmMarketplace(
  json: JsonObject,
  expectedPackage: string,
  expectedVersion: string,
  includeEntryVersion: boolean,
) {
  const plugin = findLgtmMarketplacePlugin(json);
  if (!isJsonObject(plugin.source) || plugin.source.source !== "npm") {
    throw new Error("LGTM marketplace source must use npm.");
  }
  plugin.source.package = expectedPackage;
  plugin.source.version = expectedVersion;
  if (includeEntryVersion) {
    plugin.version = expectedVersion;
  }
}

function updateLocalMarketplace(json: JsonObject) {
  const plugin = findLgtmMarketplacePlugin(json);
  plugin.source = { source: "local", path: "." };
  delete plugin.version;
}

function findLgtmMarketplacePlugin(json: JsonObject): JsonObject {
  if (!Array.isArray(json.plugins)) {
    throw new Error("Marketplace must define a plugins array.");
  }
  const plugin = json.plugins.find(
    (candidate): candidate is JsonObject => isJsonObject(candidate) && candidate.name === "lgtm",
  );
  if (!plugin) {
    throw new Error("Marketplace must define the lgtm plugin.");
  }
  return plugin;
}

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
