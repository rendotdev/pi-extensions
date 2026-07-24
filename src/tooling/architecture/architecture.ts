import { dirname, posix, resolve, sep } from "node:path";

export const domainNames = ["review", "settings", "setup"] as const;
export const domainLayers = ["types", "config", "repo", "service", "runtime", "ui"] as const;
export const productionFileLineLimit = 400;
export const testFileLineLimit = 600;
export const functionLineLimit = 80;

export function fileLineLimitForPath(_filePath: string, isTest: boolean) {
  return isTest ? testFileLineLimit : productionFileLineLimit;
}

export function functionLineLimitForPath(_filePath: string) {
  return functionLineLimit;
}

export type DomainName = (typeof domainNames)[number];
export type DomainLayer = (typeof domainLayers)[number];

export const allowedLayerDependencies: Readonly<Record<DomainLayer, readonly DomainLayer[]>> = {
  types: ["types"],
  config: ["types", "config"],
  repo: ["types", "config", "repo"],
  service: ["types", "config", "repo", "service"],
  runtime: ["types", "config", "service", "runtime"],
  ui: ["types", "config", "service", "runtime", "ui"],
};

type SourceClassification =
  | Readonly<{
      kind: "app" | "providers" | "utils" | "tooling" | "definition" | "outside-source";
    }>
  | Readonly<{ kind: "domain-public"; domain: DomainName; layer?: DomainLayer }>
  | Readonly<{ kind: "domain-layer"; domain: DomainName; layer: DomainLayer }>
  | Readonly<{ kind: "invalid"; reason: "domain" | "domain-layer" | "source-location" }>;

export type DependencyDecision = Readonly<{
  allowed: boolean;
  reason?: "app-internal-domain" | "cross-domain-internal" | "layer" | "top-level";
  source: SourceClassification;
  target: SourceClassification;
}>;

export function classifySourcePath(filePath: string): SourceClassification {
  const sourcePath = getSourceRelativePath(filePath);
  if (!sourcePath) {
    return { kind: "outside-source" };
  }
  const isDefinition = sourcePath === "define.ts" || sourcePath === "define.test.ts";
  if (isDefinition) {
    return { kind: "definition" };
  }
  const [topLevel, second, third, fourth] = sourcePath.split("/");
  const isProductionTopLevel =
    topLevel === "app" || topLevel === "providers" || topLevel === "utils";
  if (isProductionTopLevel) {
    return { kind: topLevel };
  }
  if (topLevel === "tooling") {
    return { kind: "tooling" };
  }
  if (topLevel !== "domains") {
    return { kind: "invalid", reason: "source-location" };
  }
  if (!isDomainName(second)) {
    return { kind: "invalid", reason: "domain" };
  }
  const isDomainPublicApi = third === "index.ts" || third === "index.tsx";
  if (isDomainPublicApi) {
    return { kind: "domain-public", domain: second };
  }
  const isLayerPublicApi =
    isDomainLayer(third) && (fourth === "index.ts" || fourth === "index.tsx");
  if (isLayerPublicApi) {
    return { kind: "domain-public", domain: second, layer: third };
  }
  if (!isDomainLayer(third)) {
    return { kind: "invalid", reason: "domain-layer" };
  }
  return { kind: "domain-layer", domain: second, layer: third };
}

export function resolveImportTarget(sourceFile: string, specifier: string) {
  const normalizedSpecifier = specifier.split(/[?#]/u)[0];
  if (!normalizedSpecifier) {
    return undefined;
  }
  const isRelativeImport = normalizedSpecifier.startsWith(".");
  const isSourceImport = normalizedSpecifier.startsWith("src/");
  const isLocalImport = isRelativeImport || isSourceImport;
  if (!isLocalImport) {
    return undefined;
  }
  const sourceRoot = repositoryRootForSource(sourceFile);
  const resolvedTarget = normalizePath(
    resolve(isSourceImport ? sourceRoot : dirname(sourceFile), normalizedSpecifier),
  );
  const isDomainDirectory =
    /\/src\/domains\/[^/]+(?:\/(?:types|config|repo|service|runtime|ui))?$/u.test(resolvedTarget);
  if (isDomainDirectory) {
    return `${resolvedTarget}/index.ts`;
  }
  return resolvedTarget.endsWith("/index") ? `${resolvedTarget}.ts` : resolvedTarget;
}

export function allowedDefinitionHelpersForPath(filePath: string): readonly string[] {
  const classification = classifySourcePath(filePath);
  if (classification.kind === "definition") {
    return [
      "defineApp",
      "defineConfig",
      "defineProvider",
      "defineRepo",
      "defineRuntime",
      "defineService",
      "defineSingleton",
      "defineType",
      "defineUIComponent",
      "defineUIHook",
      "defineUtil",
    ];
  }
  if (classification.kind === "providers") {
    return ["defineProvider"];
  }
  if (classification.kind === "utils") {
    return ["defineUtil"];
  }
  if (classification.kind === "app") {
    return ["defineApp", "defineRuntime", "defineSingleton", "defineUIComponent", "defineUIHook"];
  }
  if (classification.kind === "domain-layer") {
    return definitionHelpersForLayer(classification.layer);
  }
  const isLayerPublicApi =
    classification.kind === "domain-public" && classification.layer !== undefined;
  if (isLayerPublicApi) {
    return definitionHelpersForLayer(classification.layer);
  }
  return [];
}

export function validateDependency(sourceFile: string, targetFile: string): DependencyDecision {
  const source = classifySourcePath(sourceFile);
  const target = classifySourcePath(targetFile);
  const usesOutsideSource = source.kind === "outside-source" || target.kind === "outside-source";
  if (usesOutsideSource) {
    return { allowed: true, source, target };
  }
  const hasInvalidLocation = source.kind === "invalid" || target.kind === "invalid";
  if (hasInvalidLocation) {
    return { allowed: true, source, target };
  }
  if (target.kind === "definition") {
    return {
      allowed: source.kind !== "tooling",
      reason: "top-level",
      source,
      target,
    };
  }
  if (source.kind === "definition") {
    return { allowed: target.kind === "providers", reason: "top-level", source, target };
  }
  if (source.kind === "app") {
    const allowed =
      target.kind === "app" ||
      target.kind === "providers" ||
      target.kind === "utils" ||
      target.kind === "domain-public";
    return {
      allowed,
      reason: target.kind === "domain-layer" ? "app-internal-domain" : "top-level",
      source,
      target,
    };
  }
  if (source.kind === "providers") {
    const allowed = target.kind === "providers" || target.kind === "utils";
    return { allowed, reason: "top-level", source, target };
  }
  if (source.kind === "utils") {
    return { allowed: target.kind === "utils", reason: "top-level", source, target };
  }
  if (source.kind === "tooling") {
    const allowed = target.kind === "tooling" || target.kind === "utils";
    return { allowed, reason: "top-level", source, target };
  }
  if (source.kind === "domain-public") {
    if (source.layer) {
      return validateDomainLayerDependency(
        { kind: "domain-layer", domain: source.domain, layer: source.layer },
        target,
      );
    }
    const allowed = target.kind === "domain-layer" && target.domain === source.domain;
    return { allowed, reason: "top-level", source, target };
  }
  if (source.kind !== "domain-layer") {
    return { allowed: false, reason: "top-level", source, target };
  }
  return validateDomainLayerDependency(source, target);
}

export function isEnforcedSourcePath(filePath: string) {
  const classification = classifySourcePath(filePath);
  return classification.kind !== "outside-source" && classification.kind !== "invalid";
}

export function validateArchitectureModel() {
  const errors: string[] = [];
  for (const layer of domainLayers) {
    const dependencies = allowedLayerDependencies[layer];
    if (!dependencies.includes(layer)) {
      errors.push(`${layer} must be allowed to import itself.`);
    }
    for (const dependency of dependencies) {
      if (!domainLayers.includes(dependency)) {
        errors.push(`${layer} references the unknown layer ${dependency}.`);
      }
    }
  }
  const cycle = findLayerDependencyCycle(allowedLayerDependencies);
  if (cycle) {
    errors.push(`Layer dependency cycle: ${cycle.join(" -> ")}.`);
  }
  return errors;
}

function validateDomainLayerDependency(
  source: Extract<SourceClassification, { kind: "domain-layer" }>,
  target: Exclude<SourceClassification, { kind: "invalid" | "definition" }>,
): DependencyDecision {
  if (target.kind === "domain-public") {
    const allowed = target.domain !== source.domain;
    return { allowed, reason: "cross-domain-internal", source, target };
  }
  const isCrossCuttingTarget = target.kind === "providers" || target.kind === "utils";
  if (isCrossCuttingTarget) {
    const allowsProviders = ["repo", "service", "runtime", "ui"].includes(source.layer);
    return {
      allowed: target.kind === "utils" || allowsProviders,
      reason: "layer",
      source,
      target,
    };
  }
  if (target.kind !== "domain-layer") {
    return { allowed: false, reason: "top-level", source, target };
  }
  if (target.domain !== source.domain) {
    return { allowed: false, reason: "cross-domain-internal", source, target };
  }
  const allowed = allowedLayerDependencies[source.layer].includes(target.layer);
  return { allowed, reason: "layer", source, target };
}

export function findLayerDependencyCycle(
  graph: Readonly<Record<DomainLayer, readonly DomainLayer[]>>,
) {
  const visited = new Set<DomainLayer>();
  const active = new Set<DomainLayer>();
  const path: DomainLayer[] = [];
  function visit(layer: DomainLayer): DomainLayer[] | undefined {
    visited.add(layer);
    active.add(layer);
    path.push(layer);
    for (const dependency of graph[layer]) {
      if (dependency === layer) {
        continue;
      }
      if (active.has(dependency)) {
        return [...path.slice(path.indexOf(dependency)), dependency];
      }
      if (!visited.has(dependency)) {
        const cycle = visit(dependency);
        if (cycle) {
          return cycle;
        }
      }
    }
    path.pop();
    active.delete(layer);
    return undefined;
  }
  for (const layer of domainLayers) {
    if (!visited.has(layer)) {
      const cycle = visit(layer);
      if (cycle) {
        return cycle;
      }
    }
  }
  return undefined;
}

export function findDomainDependencyCycle(
  graph: Readonly<Partial<Record<DomainName, readonly DomainName[]>>>,
) {
  const visited = new Set<DomainName>();
  const active = new Set<DomainName>();
  const path: DomainName[] = [];
  function visit(domain: DomainName): DomainName[] | undefined {
    visited.add(domain);
    active.add(domain);
    path.push(domain);
    for (const dependency of graph[domain] ?? []) {
      if (active.has(dependency)) {
        return [...path.slice(path.indexOf(dependency)), dependency];
      }
      if (!visited.has(dependency)) {
        const cycle = visit(dependency);
        if (cycle) {
          return cycle;
        }
      }
    }
    path.pop();
    active.delete(domain);
    return undefined;
  }
  for (const domain of domainNames) {
    if (!visited.has(domain)) {
      const cycle = visit(domain);
      if (cycle) {
        return cycle;
      }
    }
  }
  return undefined;
}

function getSourceRelativePath(filePath: string) {
  const normalized = normalizePath(filePath);
  const marker = "/src/";
  const markerIndex = normalized.lastIndexOf(marker);
  if (markerIndex >= 0) {
    return normalized.slice(markerIndex + marker.length);
  }
  return normalized.startsWith("src/") ? normalized.slice("src/".length) : undefined;
}

function repositoryRootForSource(filePath: string) {
  const normalized = normalizePath(filePath);
  const sourceMarkerIndex = normalized.lastIndexOf("/src/");
  return sourceMarkerIndex >= 0 ? normalized.slice(0, sourceMarkerIndex) : process.cwd();
}

function definitionHelpersForLayer(layer: DomainLayer) {
  if (layer === "types") {
    return ["defineType"];
  }
  if (layer === "config") {
    return ["defineConfig"];
  }
  if (layer === "repo") {
    return ["defineRepo"];
  }
  if (layer === "service") {
    return ["defineService", "defineSingleton"];
  }
  if (layer === "runtime") {
    return ["defineRuntime", "defineSingleton"];
  }
  if (layer === "ui") {
    return [
      "defineRuntime",
      "defineService",
      "defineSingleton",
      "defineUIComponent",
      "defineUIHook",
    ];
  }
  return [];
}

function isDomainName(value: string | undefined): value is DomainName {
  return domainNames.some((domain) => domain === value);
}

function isDomainLayer(value: string | undefined): value is DomainLayer {
  return domainLayers.some((layer) => layer === value);
}

function normalizePath(filePath: string) {
  return posix.normalize(filePath.split(sep).join("/"));
}
