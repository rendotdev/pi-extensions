import { describe, expect, it, vi } from "vite-plus/test";
import type { Context, ESTree, Rule } from "@oxlint/plugins";
import {
  applicationClassConventionsRule,
  namedCompoundIfConditionRule,
  pascalCaseClassInstanceRule,
  publicMethodParamsRule,
} from "../../../scripts/oxlint-plugin.ts";

describe("namedCompoundIfConditionRule", () => {
  it("reports logical expressions used directly by if statements", () => {
    const report = vi.fn();
    const visitor = createVisitor(namedCompoundIfConditionRule, report);

    visitor.IfStatement?.({ test: { type: "LogicalExpression" } } as ESTree.IfStatement);

    expect(report).toHaveBeenCalledWith({
      node: { type: "LogicalExpression" },
      messageId: "nameCondition",
    });
  });

  it("allows named boolean conditions", () => {
    const report = vi.fn();
    const visitor = createVisitor(namedCompoundIfConditionRule, report);

    visitor.IfStatement?.({ test: { type: "Identifier" } } as ESTree.IfStatement);

    expect(report).not.toHaveBeenCalled();
  });
});

describe("applicationClassConventionsRule", () => {
  it("allows Class-suffixed DomainClass subclasses", () => {
    const report = vi.fn();
    const visitor = createVisitor(applicationClassConventionsRule, report);

    visitor.ClassDeclaration?.({
      id: { name: "ExampleClass" },
      superClass: { type: "Identifier", name: "DomainClass" },
      body: { body: [] },
    } as unknown as ESTree.Class);

    expect(report).not.toHaveBeenCalled();
  });

  it("reports invalid class names and inheritance", () => {
    const report = vi.fn();
    const visitor = createVisitor(applicationClassConventionsRule, report);

    visitor.ClassDeclaration?.({
      id: { name: "Example" },
      superClass: null,
      body: { body: [] },
    } as unknown as ESTree.Class);

    expect(report).toHaveBeenCalledWith({
      node: { name: "Example" },
      messageId: "className",
    });
    expect(report).toHaveBeenCalledWith(expect.objectContaining({ messageId: "inheritance" }));
  });

  it("reports constructors that do not accept params then deps", () => {
    const report = vi.fn();
    const visitor = createVisitor(applicationClassConventionsRule, report);

    visitor.ClassDeclaration?.({
      id: { name: "ExampleClass" },
      superClass: { type: "Identifier", name: "DomainClass" },
      body: {
        body: [
          {
            type: "MethodDefinition",
            kind: "constructor",
            value: { params: [{ type: "Identifier", name: "options" }] },
          },
        ],
      },
    } as ESTree.Class);

    expect(report).toHaveBeenCalledWith(expect.objectContaining({ messageId: "constructor" }));
  });
});

describe("pascalCaseClassInstanceRule", () => {
  it("reports camelCase application class instances", () => {
    const report = vi.fn();
    const visitor = createVisitor(pascalCaseClassInstanceRule, report);

    visitor.VariableDeclarator?.({
      id: { type: "Identifier", name: "example" },
      init: {
        type: "NewExpression",
        callee: { type: "Identifier", name: "ExampleClass" },
      },
    } as ESTree.VariableDeclarator);

    expect(report).toHaveBeenCalledWith({
      node: { type: "Identifier", name: "example" },
      messageId: "instanceName",
    });
  });

  it("allows PascalCase application class instances", () => {
    const report = vi.fn();
    const visitor = createVisitor(pascalCaseClassInstanceRule, report);

    visitor.VariableDeclarator?.({
      id: { type: "Identifier", name: "Example" },
      init: {
        type: "NewExpression",
        callee: { type: "Identifier", name: "ExampleClass" },
      },
    } as ESTree.VariableDeclarator);

    expect(report).not.toHaveBeenCalled();
  });
});

describe("publicMethodParamsRule", () => {
  it("reports public method inputs that do not use one params object", () => {
    const report = vi.fn();
    const visitor = createVisitor(publicMethodParamsRule, report);

    visitor.MethodDefinition?.({
      kind: "method",
      accessibility: "public",
      value: {
        params: [
          { type: "Identifier", name: "value" },
          { type: "Identifier", name: "options" },
        ],
      },
    } as unknown as ESTree.MethodDefinition);

    expect(report).toHaveBeenCalledWith(expect.objectContaining({ messageId: "params" }));
  });

  it("allows one public method argument named params", () => {
    const report = vi.fn();
    const visitor = createVisitor(publicMethodParamsRule, report);

    visitor.MethodDefinition?.({
      kind: "method",
      accessibility: "public",
      value: { params: [{ type: "Identifier", name: "params" }] },
    } as unknown as ESTree.MethodDefinition);

    expect(report).not.toHaveBeenCalled();
  });
});

function createVisitor(rule: Rule, report: ReturnType<typeof vi.fn>) {
  const create = rule.create;
  if (!create) {
    throw new Error("The Oxlint rule must provide a create visitor.");
  }
  return create({ report } as unknown as Context);
}
