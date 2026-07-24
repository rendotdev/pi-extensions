import type { Context, ESTree, Rule } from "@oxlint/plugins";
import { describe, expect, it, vi } from "vite-plus/test";
import {
  domainPublicApiRule,
  definitionHelpersRule,
  layerBoundariesRule,
  maxFileLinesRule,
  maxFunctionLinesRule,
  namedCompoundIfConditionRule,
  sourceLocationRule,
} from "./oxlint-plugin.ts";

describe("architecture dependency rules", () => {
  it("reports a forbidden layer dependency with remediation", () => {
    const report = vi.fn();
    const visitor = createVisitor(
      layerBoundariesRule,
      createContext("/repo/src/domains/review/service/review.ts", "", report),
    );

    visitor.ImportDeclaration?.(importNode("../runtime/server.ts") as ESTree.ImportDeclaration);

    expect(report).toHaveBeenCalledWith({
      node: expect.objectContaining({ value: "../runtime/server.ts" }),
      messageId: "invalidDependency",
    });
    expect(layerBoundariesRule.meta?.messages?.invalidDependency).toContain(
      "move orchestration to runtime/app",
    );
  });

  it("allows dependencies on earlier layers", () => {
    const report = vi.fn();
    const visitor = createVisitor(
      layerBoundariesRule,
      createContext("/repo/src/domains/review/service/review.ts", "", report),
    );

    visitor.ImportDeclaration?.(importNode("../repo/store.ts") as ESTree.ImportDeclaration);

    expect(report).not.toHaveBeenCalled();
  });

  it("reports app and cross-domain deep imports through the public API rule", () => {
    const appReport = vi.fn();
    const appVisitor = createVisitor(
      domainPublicApiRule,
      createContext("/repo/src/app/cli/cli.ts", "", appReport),
    );
    appVisitor.ImportDeclaration?.(
      importNode("../../domains/review/service/review.ts") as ESTree.ImportDeclaration,
    );

    const domainReport = vi.fn();
    const domainVisitor = createVisitor(
      domainPublicApiRule,
      createContext("/repo/src/domains/review/service/review.ts", "", domainReport),
    );
    domainVisitor.ExportAllDeclaration?.(
      exportAllNode("../../settings/repo/store.ts") as ESTree.ExportAllDeclaration,
    );

    expect(appReport).toHaveBeenCalledOnce();
    expect(domainReport).toHaveBeenCalledOnce();
    expect(domainPublicApiRule.meta?.messages?.invalidDependency).toContain("layer index.ts");
  });

  it("allows domain public API imports", () => {
    const report = vi.fn();
    const visitor = createVisitor(
      domainPublicApiRule,
      createContext("/repo/src/app/cli/cli.ts", "", report),
    );

    visitor.ImportDeclaration?.(
      importNode("../../domains/review/index.ts") as ESTree.ImportDeclaration,
    );

    expect(report).not.toHaveBeenCalled();
  });
});

describe("definition helper rule", () => {
  it("rejects a runtime helper in a service layer", () => {
    const report = vi.fn();
    const visitor = createVisitor(
      definitionHelpersRule,
      createContext("/repo/src/domains/review/service/review.ts", "", report),
    );

    visitor.ImportDeclaration?.(definitionImportNode("defineRuntime") as ESTree.ImportDeclaration);

    expect(report).toHaveBeenCalledWith({
      node: expect.objectContaining({ type: "ImportSpecifier" }),
      messageId: "wrongHelper",
    });
  });

  it("allows intentional UI service helpers", () => {
    const report = vi.fn();
    const visitor = createVisitor(
      definitionHelpersRule,
      createContext("/repo/src/domains/review/ui/presentation.ts", "", report),
    );

    visitor.ImportDeclaration?.(definitionImportNode("defineService") as ESTree.ImportDeclaration);

    expect(report).not.toHaveBeenCalled();
  });
});

describe("source location rule", () => {
  it("reports unknown domain layers with a concrete destination", () => {
    const report = vi.fn();
    const visitor = createVisitor(
      sourceLocationRule,
      createContext("/repo/src/domains/review/helpers/helper.ts", "", report),
    );

    visitor.Program?.({ type: "Program" } as ESTree.Program);

    expect(report).toHaveBeenCalledWith({
      node: { type: "Program" },
      messageId: "invalidLayer",
    });
    expect(sourceLocationRule.meta?.messages?.invalidLayer).toContain("types, config, repo");
  });

  it("rejects removed legacy locations", () => {
    const report = vi.fn();
    const visitor = createVisitor(
      sourceLocationRule,
      createContext("/repo/src/modules/review/review.ts", "", report),
    );

    visitor.Program?.({ type: "Program" } as ESTree.Program);

    expect(report).toHaveBeenCalledWith({
      node: { type: "Program" },
      messageId: "invalidLocation",
    });
  });
});

describe("size rules", () => {
  it("reports production files above 400 meaningful lines", () => {
    const report = vi.fn();
    const text = meaningfulSource(401);
    const visitor = createVisitor(
      maxFileLinesRule,
      createContext("/repo/src/domains/review/service/review.ts", text, report),
    );

    visitor.Program?.({ type: "Program" } as ESTree.Program);

    expect(report).toHaveBeenCalledWith({ node: { type: "Program" }, messageId: "tooLarge" });
    expect(maxFileLinesRule.meta?.messages?.tooLarge).toContain("domain responsibility or layer");
  });

  it("allows test files up to 600 meaningful lines", () => {
    const report = vi.fn();
    const text = meaningfulSource(600);
    const visitor = createVisitor(
      maxFileLinesRule,
      createContext("/repo/src/domains/review/service/review.test.ts", text, report),
    );

    visitor.Program?.({ type: "Program" } as ESTree.Program);

    expect(report).not.toHaveBeenCalled();
  });

  it("does not count blank or comment-only lines", () => {
    const report = vi.fn();
    const comment = "// architecture context";
    const text = `${meaningfulSource(400)}\n\n${comment}`;
    const context = createContext("/repo/src/domains/review/service/review.ts", text, report, [
      {
        type: "Line",
        value: " architecture context",
        range: [text.lastIndexOf(comment), text.length],
      },
    ]);
    const visitor = createVisitor(maxFileLinesRule, context);

    visitor.Program?.({ type: "Program" } as ESTree.Program);

    expect(report).not.toHaveBeenCalled();
  });

  it("reports functions and methods above 80 meaningful lines", () => {
    const report = vi.fn();
    const text = meaningfulSource(81);
    const visitor = createVisitor(
      maxFunctionLinesRule,
      createContext("/repo/src/domains/review/runtime/server.ts", text, report),
    );
    const node = { type: "FunctionDeclaration", range: [0, text.length] };

    visitor.FunctionDeclaration?.(node as ESTree.Function);

    expect(report).toHaveBeenCalledWith({ node, messageId: "tooLarge" });
    expect(maxFunctionLinesRule.meta?.messages?.tooLarge).toContain("appropriate runtime");
  });

  it("allows describe callbacks to organize large test suites", () => {
    const report = vi.fn();
    const text = meaningfulSource(81);
    const visitor = createVisitor(
      maxFunctionLinesRule,
      createContext("/repo/src/domains/review/service/review.test.ts", text, report),
    );
    const node = {
      type: "ArrowFunctionExpression",
      range: [0, text.length],
      parent: { type: "CallExpression", callee: { type: "Identifier", name: "describe" } },
    };

    visitor.ArrowFunctionExpression?.(node as ESTree.ArrowFunctionExpression);

    expect(report).not.toHaveBeenCalled();
  });
});

describe("named compound if condition rule", () => {
  it("preserves the existing compound-condition invariant", () => {
    const report = vi.fn();
    const visitor = createVisitor(
      namedCompoundIfConditionRule,
      createContext("/repo/src/domains/review/service/review.ts", "", report),
    );

    visitor.IfStatement?.({ test: { type: "LogicalExpression" } } as ESTree.IfStatement);

    expect(report).toHaveBeenCalledWith({
      node: { type: "LogicalExpression" },
      messageId: "nameCondition",
    });
  });
});

function createContext(
  filename: string,
  text: string,
  report: ReturnType<typeof vi.fn>,
  comments: Array<{ type: string; value: string; range: [number, number] }> = [],
) {
  return {
    filename,
    report,
    sourceCode: {
      text,
      getAllComments() {
        return comments;
      },
    },
  } as unknown as Context;
}

function createVisitor(rule: Rule, context: Context) {
  const create = rule.create;
  if (!create) {
    throw new Error("The Oxlint rule must provide a create visitor.");
  }
  return create(context);
}

function importNode(value: string) {
  return { type: "ImportDeclaration", source: { type: "Literal", value } };
}

function exportAllNode(value: string) {
  return { type: "ExportAllDeclaration", source: { type: "Literal", value } };
}

function definitionImportNode(name: string) {
  return {
    type: "ImportDeclaration",
    source: { type: "Literal", value: "../../../../define.ts" },
    specifiers: [
      {
        type: "ImportSpecifier",
        imported: { type: "Identifier", name },
        local: { type: "Identifier", name },
      },
    ],
  };
}

function meaningfulSource(lines: number) {
  return Array.from({ length: lines }, (_, index) => `const value${index} = ${index};`).join("\n");
}
