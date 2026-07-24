import { definePlugin } from "@oxlint/plugins";
import { domainPublicApiRule } from "./rules/domain-public-api.ts";
import { definitionHelpersRule } from "./rules/definition-helpers.ts";
import { layerBoundariesRule } from "./rules/layer-boundaries.ts";
import { maxFileLinesRule } from "./rules/max-file-lines.ts";
import { maxFunctionLinesRule } from "./rules/max-function-lines.ts";
import { namedCompoundIfConditionRule } from "./rules/named-compound-if-condition.ts";
import { sourceLocationRule } from "./rules/source-location.ts";

export {
  domainPublicApiRule,
  definitionHelpersRule,
  layerBoundariesRule,
  maxFileLinesRule,
  maxFunctionLinesRule,
  namedCompoundIfConditionRule,
  sourceLocationRule,
};

export default definePlugin({
  meta: { name: "lgtm" },
  rules: {
    "domain-public-api": domainPublicApiRule,
    "definition-helpers": definitionHelpersRule,
    "layer-boundaries": layerBoundariesRule,
    "max-file-lines": maxFileLinesRule,
    "max-function-lines": maxFunctionLinesRule,
    "named-compound-if-condition": namedCompoundIfConditionRule,
    "source-location": sourceLocationRule,
  },
});
