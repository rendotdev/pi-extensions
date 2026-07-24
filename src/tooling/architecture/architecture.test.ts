import { access, readFile, readdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vite-plus/test";
import {
  allowedLayerDependencies,
  allowedDefinitionHelpersForPath,
  classifySourcePath,
  type DomainName,
  domainLayers,
  domainNames,
  fileLineLimitForPath,
  findDomainDependencyCycle,
  findLayerDependencyCycle,
  functionLineLimitForPath,
  resolveImportTarget,
  validateArchitectureModel,
  validateDependency,
} from "./architecture.ts";

const root = "/repo/src";
const sourceRoot = resolve(import.meta.dirname, "../..");

describe("architecture model", () => {
  it("defines an acyclic dependency graph", () => {
    expect(validateArchitectureModel()).toEqual([]);
  });

  it("applies the architecture size limits uniformly", () => {
    expect(fileLineLimitForPath("/repo/src/app/cli/cli.ts", false)).toBe(400);
    expect(functionLineLimitForPath("/repo/src/app/cli/cli.ts")).toBe(80);
    expect(fileLineLimitForPath("/repo/src/domains/review/service/new.ts", false)).toBe(400);
    expect(functionLineLimitForPath("/repo/src/domains/review/service/new.ts")).toBe(80);
  });

  it("detects a dependency cycle", () => {
    const cyclicGraph = { ...allowedLayerDependencies, types: ["types", "ui"] } as const;

    expect(findLayerDependencyCycle(cyclicGraph)).toEqual(["types", "ui", "types"]);
  });

  it("requires every configured domain to expose a public API", async () => {
    for (const domain of domainNames) {
      await expect(
        access(join(sourceRoot, "domains", domain, "index.ts")),
      ).resolves.toBeUndefined();
    }
  });

  it("keeps the repository cross-domain graph acyclic", async () => {
    const graph = await collectDomainDependencyGraph();

    expect(findDomainDependencyCycle(graph)).toBeUndefined();
  });

  it("defines every source and target layer edge", () => {
    for (const source of domainLayers) {
      for (const target of domainLayers) {
        const decision = validateDependency(
          `${root}/domains/review/${source}/source.ts`,
          `${root}/domains/review/${target}/target.ts`,
        );
        expect(decision.allowed, `${source} -> ${target}`).toBe(
          allowedLayerDependencies[source].includes(target),
        );
      }
    }
  });

  it("allows providers only in behavior-bearing domain layers", () => {
    for (const layer of domainLayers) {
      const decision = validateDependency(
        `${root}/domains/review/${layer}/source.ts`,
        `${root}/providers/filesystem/filesystem.ts`,
      );
      expect(decision.allowed, layer).toBe(["repo", "service", "runtime", "ui"].includes(layer));
    }
  });
});

describe("dependency boundaries", () => {
  it("requires app and cross-domain imports to use public APIs", () => {
    expect(
      validateDependency(`${root}/app/cli/cli.ts`, `${root}/domains/review/service/review.ts`)
        .allowed,
    ).toBe(false);
    expect(
      validateDependency(`${root}/app/cli/cli.ts`, `${root}/domains/review/index.ts`).allowed,
    ).toBe(true);
    expect(
      validateDependency(`${root}/app/web/main.tsx`, `${root}/domains/review/ui/index.ts`).allowed,
    ).toBe(true);
    expect(
      validateDependency(
        `${root}/domains/review/service/review.ts`,
        `${root}/domains/settings/repo/store.ts`,
      ).allowed,
    ).toBe(false);
    expect(
      validateDependency(
        `${root}/domains/review/service/review.ts`,
        `${root}/domains/settings/index.ts`,
      ).allowed,
    ).toBe(true);
  });

  it("isolates providers, utilities, tooling, and app wiring", () => {
    expect(
      validateDependency(
        `${root}/providers/filesystem/filesystem.ts`,
        `${root}/domains/review/index.ts`,
      ).allowed,
    ).toBe(false);
    expect(
      validateDependency(`${root}/utils/arrays.ts`, `${root}/providers/time/time.ts`).allowed,
    ).toBe(false);
    expect(
      validateDependency(`${root}/domains/review/ui/review.tsx`, `${root}/app/web/main.tsx`)
        .allowed,
    ).toBe(false);
    expect(
      validateDependency(
        `${root}/domains/review/service/review.ts`,
        `${root}/tooling/architecture/architecture.ts`,
      ).allowed,
    ).toBe(false);
  });
});

describe("source classification", () => {
  it("classifies invalid domains and layers", () => {
    expect(classifySourcePath(`${root}/domains/payments/types/payment.ts`)).toEqual({
      kind: "invalid",
      reason: "domain",
    });
    expect(classifySourcePath(`${root}/domains/review/helpers/helper.ts`)).toEqual({
      kind: "invalid",
      reason: "domain-layer",
    });
  });

  it("recognizes domain and layer public entrypoints", () => {
    expect(classifySourcePath(`${root}/domains/review/index.ts`)).toEqual({
      kind: "domain-public",
      domain: "review",
    });
    expect(classifySourcePath(`${root}/domains/review/ui/index.ts`)).toEqual({
      kind: "domain-public",
      domain: "review",
      layer: "ui",
    });
  });

  it("applies layer boundaries to layer public entrypoints", () => {
    expect(
      validateDependency(
        `${root}/domains/review/ui/index.ts`,
        `${root}/domains/review/repo/git/git.ts`,
      ).allowed,
    ).toBe(false);
    expect(
      validateDependency(
        `${root}/domains/review/runtime/index.ts`,
        `${root}/domains/review/service/review/review.ts`,
      ).allowed,
    ).toBe(true);
  });

  it("rejects removed legacy source locations", () => {
    for (const path of ["modules/review/review.ts", "entrypoints/cli/cli.ts", "web/main.tsx"]) {
      expect(classifySourcePath(`${root}/${path}`)).toEqual({
        kind: "invalid",
        reason: "source-location",
      });
    }
  });

  it("resolves local imports without treating packages as source dependencies", () => {
    expect(resolveImportTarget(`${root}/app/cli/cli.ts`, "../../domains/review/index.ts")).toBe(
      `${root}/domains/review/index.ts`,
    );
    expect(resolveImportTarget(`${root}/app/cli/cli.ts`, "react")).toBeUndefined();
    expect(resolveImportTarget(`${root}/app/cli/cli.ts`, "../../domains/review")).toBe(
      `${root}/domains/review/index.ts`,
    );
    expect(resolveImportTarget(`${root}/app/web/main.tsx`, "src/domains/review/ui")).toBe(
      `${root}/domains/review/ui/index.ts`,
    );
  });

  it("maps definition helpers to their architectural layer", () => {
    expect(allowedDefinitionHelpersForPath(`${root}/define.test.ts`)).toContain("defineRepo");
    expect(allowedDefinitionHelpersForPath(`${root}/domains/review/repo/git.ts`)).toEqual([
      "defineRepo",
    ]);
    expect(allowedDefinitionHelpersForPath(`${root}/domains/review/types/review.ts`)).toEqual([
      "defineType",
    ]);
    expect(allowedDefinitionHelpersForPath(`${root}/domains/review/config/defaults.ts`)).toEqual([
      "defineConfig",
    ]);
    expect(allowedDefinitionHelpersForPath(`${root}/utils/array.ts`)).toEqual(["defineUtil"]);
    expect(allowedDefinitionHelpersForPath(`${root}/providers/time.ts`)).toEqual([
      "defineProvider",
    ]);
    expect(allowedDefinitionHelpersForPath(`${root}/domains/review/ui/presentation.ts`)).toContain(
      "defineService",
    );
  });
});

async function collectDomainDependencyGraph() {
  const graph: Partial<Record<DomainName, Set<DomainName>>> = {};
  const relativeFiles = await readdir(sourceRoot, { recursive: true });
  for (const relativeFile of relativeFiles) {
    const isSourceFile = /\.[cm]?[jt]sx?$/u.test(relativeFile);
    const isDependencyFile = relativeFile.includes("node_modules/");
    const shouldSkipFile = !isSourceFile || isDependencyFile;
    if (shouldSkipFile) {
      continue;
    }
    const sourceFile = join(sourceRoot, relativeFile);
    const source = classifySourcePath(sourceFile);
    const isDomainSource = source.kind === "domain-layer" || source.kind === "domain-public";
    if (!isDomainSource) {
      continue;
    }
    const sourceText = await readFile(sourceFile, "utf8");
    for (const match of sourceText.matchAll(/(?:from\s*|import\s*\()\s*["']([^"']+)["']/gu)) {
      const targetFile = resolveImportTarget(sourceFile, match[1] ?? "");
      if (!targetFile) {
        continue;
      }
      const target = classifySourcePath(targetFile);
      const isCrossDomainPublicImport =
        target.kind === "domain-public" && target.domain !== source.domain;
      if (isCrossDomainPublicImport) {
        (graph[source.domain] ??= new Set()).add(target.domain);
      }
    }
  }
  return Object.fromEntries(
    Object.entries(graph).map(([domain, dependencies]) => [domain, [...dependencies]]),
  );
}
