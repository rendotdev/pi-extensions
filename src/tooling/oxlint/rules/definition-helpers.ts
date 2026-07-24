import type { ESTree } from "@oxlint/plugins";
import { defineRule } from "@oxlint/plugins";
import {
  allowedDefinitionHelpersForPath,
  isEnforcedSourcePath,
} from "../../architecture/architecture.ts";

const definitionHelpers = new Set([
  "defineApp",
  "defineClass",
  "defineComponent",
  "defineConfig",
  "defineEntrypoint",
  "defineHook",
  "defineProvider",
  "defineRepo",
  "defineRuntime",
  "defineService",
  "defineSingleton",
  "defineType",
  "defineUIComponent",
  "defineUIHook",
  "defineUtil",
]);

export const definitionHelpersRule = defineRule({
  meta: {
    type: "problem",
    docs: { description: "Require definition helpers to match the source architecture layer." },
    messages: {
      wrongHelper:
        "This definition helper does not match the file's architecture layer. Use the layer-specific helper documented in ARCHITECTURE.md or move the implementation.",
      namespaceImport:
        "Import definition helpers by name so the architecture rule can verify each helper.",
    },
  },
  create(context) {
    if (!isEnforcedSourcePath(context.filename)) {
      return {};
    }
    const allowedHelpers = allowedDefinitionHelpersForPath(context.filename);
    return {
      ImportDeclaration(node: ESTree.ImportDeclaration) {
        const isDefinitionImport = /(?:^|\/)define\.ts$/u.test(node.source.value);
        if (!isDefinitionImport) {
          return;
        }
        for (const specifier of node.specifiers) {
          if (specifier.type === "ImportNamespaceSpecifier") {
            context.report({ node: specifier, messageId: "namespaceImport" });
            continue;
          }
          if (specifier.type !== "ImportSpecifier") {
            continue;
          }
          const importedName =
            specifier.imported.type === "Identifier"
              ? specifier.imported.name
              : specifier.imported.value;
          const isWrongHelper =
            definitionHelpers.has(importedName) && !allowedHelpers.includes(importedName);
          if (isWrongHelper) {
            context.report({ node: specifier, messageId: "wrongHelper" });
          }
        }
      },
    };
  },
});
