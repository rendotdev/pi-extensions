import { defineDependencyRule, isPublicApiViolation } from "./dependency.ts";

export const layerBoundariesRule = defineDependencyRule({
  description: "Enforce the layered domain dependency graph and top-level source boundaries.",
  message:
    "This dependency crosses a forbidden architecture edge. Depend only on earlier allowed layers, or move orchestration to runtime/app. See ARCHITECTURE.md.",
  shouldReport(decision) {
    return !decision.allowed && !isPublicApiViolation(decision);
  },
});
