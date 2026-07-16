import { definePlugin, defineRule } from "@oxlint/plugins";

export const namedCompoundIfConditionRule = defineRule({
  meta: {
    type: "suggestion",
    docs: {
      description: "Require compound if conditions to use a descriptive boolean variable.",
    },
    messages: {
      nameCondition:
        "Assign this compound condition to a descriptive boolean const before the if statement.",
    },
  },
  create(context) {
    return {
      IfStatement(node) {
        if (node.test.type !== "LogicalExpression") {
          return;
        }

        context.report({ node: node.test, messageId: "nameCondition" });
      },
    };
  },
});

export const applicationClassConventionsRule = defineRule({
  meta: {
    type: "suggestion",
    docs: {
      description: "Enforce the repository's application class structure.",
    },
    messages: {
      className: "Name application classes with a Class suffix.",
      constructor:
        "Define application class constructors with params and deps as their two arguments.",
      inheritance: "Extend DomainClass or an approved specialized Class base.",
    },
  },
  create(context) {
    return {
      ClassDeclaration(node) {
        const classId = node.id;
        if (!classId) {
          return;
        }
        const className = classId.name;
        if (!className.endsWith("Class")) {
          context.report({ node: classId, messageId: "className" });
        }

        const baseClassName = node.superClass?.type === "Identifier" ? node.superClass.name : null;
        const hasApprovedBaseClass =
          className === "DomainClass" || baseClassName?.endsWith("Class") === true;
        if (!hasApprovedBaseClass) {
          context.report({ node, messageId: "inheritance" });
        }

        const constructor = node.body.body.find(
          (element) => element.type === "MethodDefinition" && element.kind === "constructor",
        );
        const hasConcreteConstructor = constructor && constructor.type === "MethodDefinition";
        if (!hasConcreteConstructor) {
          return;
        }
        const parameterNames = constructor.value.params.map((parameter) => {
          const value = parameter.type === "TSParameterProperty" ? parameter.parameter : parameter;
          return value.type === "Identifier" ? value.name : null;
        });
        const hasStandardConstructor =
          parameterNames.length === 2 &&
          parameterNames[0] === "params" &&
          parameterNames[1] === "deps";
        if (!hasStandardConstructor) {
          context.report({ node: constructor, messageId: "constructor" });
        }
      },
    };
  },
});

export const pascalCaseClassInstanceRule = defineRule({
  meta: {
    type: "suggestion",
    docs: {
      description: "Require variables holding application class instances to use PascalCase.",
    },
    messages: {
      instanceName: "Name variables holding application class instances in PascalCase.",
    },
  },
  create(context) {
    return {
      VariableDeclarator(node) {
        if (node.id.type !== "Identifier") {
          return;
        }
        const initializer = node.init;
        if (initializer?.type !== "NewExpression") {
          return;
        }
        const className =
          initializer.callee.type === "Identifier"
            ? initializer.callee.name
            : initializer.callee.type === "MemberExpression" &&
                !initializer.callee.computed &&
                initializer.callee.property.type === "Identifier"
              ? initializer.callee.property.name
              : null;
        const holdsApplicationClass = className?.endsWith("Class") === true;
        const isPascalCase = /^[A-Z][A-Za-z0-9]*$/.test(node.id.name);
        const hasInvalidInstanceName = holdsApplicationClass && !isPascalCase;
        if (hasInvalidInstanceName) {
          context.report({ node: node.id, messageId: "instanceName" });
        }
      },
    };
  },
});

export const publicMethodParamsRule = defineRule({
  meta: {
    type: "suggestion",
    docs: {
      description: "Require public method inputs to use one params object.",
    },
    messages: {
      params: "Pass public method inputs through one argument named params.",
    },
  },
  create(context) {
    return {
      MethodDefinition(node) {
        const isPublicMethod = node.kind === "method" && node.accessibility === "public";
        if (!isPublicMethod) {
          return;
        }
        if (node.value.params.length === 0) {
          return;
        }
        const parameter = node.value.params[0];
        const value = parameter?.type === "TSParameterProperty" ? parameter.parameter : parameter;
        const hasParamsObject =
          node.value.params.length === 1 && value?.type === "Identifier" && value.name === "params";
        if (!hasParamsObject) {
          context.report({ node, messageId: "params" });
        }
      },
    };
  },
});

export default definePlugin({
  meta: { name: "lgtm" },
  rules: {
    "application-class-conventions": applicationClassConventionsRule,
    "named-compound-if-condition": namedCompoundIfConditionRule,
    "pascal-case-class-instance": pascalCaseClassInstanceRule,
    "public-method-params": publicMethodParamsRule,
  },
});
