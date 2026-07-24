import { defineRule } from "@oxlint/plugins";

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
