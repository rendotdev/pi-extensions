import type { ESTree, Node, Rule } from "@oxlint/plugins";
import { defineRule } from "@oxlint/plugins";
import {
  resolveImportTarget,
  type DependencyDecision,
  validateDependency,
} from "../../architecture/architecture.ts";

type DependencyRuleDefinition = Readonly<{
  description: string;
  message: string;
  shouldReport(decision: DependencyDecision): boolean;
}>;

export function defineDependencyRule(definition: DependencyRuleDefinition): Rule {
  return defineRule({
    meta: {
      type: "problem",
      docs: { description: definition.description },
      messages: { invalidDependency: definition.message },
    },
    create(context) {
      function inspect(node: Node, specifier: string) {
        const target = resolveImportTarget(context.filename, specifier);
        if (!target) {
          return;
        }
        const decision = validateDependency(context.filename, target);
        if (definition.shouldReport(decision)) {
          context.report({ node, messageId: "invalidDependency" });
        }
      }
      return {
        ImportDeclaration(node: ESTree.ImportDeclaration) {
          inspect(node.source, node.source.value);
        },
        ExportNamedDeclaration(node: ESTree.ExportNamedDeclaration) {
          if (node.source) {
            inspect(node.source, node.source.value);
          }
        },
        ExportAllDeclaration(node: ESTree.ExportAllDeclaration) {
          inspect(node.source, node.source.value);
        },
        ImportExpression(node: ESTree.ImportExpression) {
          if (node.source.type !== "Literal") {
            return;
          }
          const specifier = node.source.value;
          if (typeof specifier === "string") {
            inspect(node.source, specifier);
          }
        },
      };
    },
  });
}

export function isPublicApiViolation(decision: DependencyDecision) {
  return (
    !decision.allowed &&
    (decision.reason === "app-internal-domain" || decision.reason === "cross-domain-internal")
  );
}
