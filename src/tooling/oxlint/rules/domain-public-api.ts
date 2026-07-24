import { defineDependencyRule, isPublicApiViolation } from "./dependency.ts";

export const domainPublicApiRule = defineDependencyRule({
  description: "Require app and cross-domain imports to use a domain or layer public API.",
  message:
    "Import this capability through the target domain or layer index.ts. Keep internal files private to their domain.",
  shouldReport: isPublicApiViolation,
});
