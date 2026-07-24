import { defineService } from "../../../../define.ts";
import { agentInstallTargets } from "../../config/agent-install/agent-install.ts";
import type {
  AgentInstallStep,
  AgentInstallTarget,
} from "../../types/agent-install/agent-install.ts";

export class AgentInstallService extends defineService({ params: {}, deps: {} }) {
  public createInstallPlan(params: { target: AgentInstallTarget }): AgentInstallStep[] {
    function createInstallSteps(target: Exclude<AgentInstallTarget, "all">): AgentInstallStep[] {
      if (target === "pi") {
        return [{ target, command: "pi", args: ["install", "npm:@rendotdev/lgtm"] }];
      }
      if (target === "claude") {
        return [
          {
            target,
            command: "claude",
            args: ["plugin", "marketplace", "add", "https://github.com/rendotdev/lgtm"],
          },
          { target, command: "claude", args: ["plugin", "install", "lgtm@rendotdev"] },
        ];
      }
      return [
        {
          target,
          command: "codex",
          args: ["plugin", "marketplace", "add", "rendotdev/lgtm"],
        },
        { target, command: "codex", args: ["plugin", "add", "lgtm@rendotdev"] },
      ];
    }

    if (params.target !== "all") {
      return createInstallSteps(params.target);
    }
    return (["pi", "claude", "codex"] as const).flatMap(createInstallSteps);
  }

  public createUpdatePlan(params: { target: AgentInstallTarget }): AgentInstallStep[] {
    function createUpdateSteps(target: Exclude<AgentInstallTarget, "all">): AgentInstallStep[] {
      if (target === "pi") {
        return [{ target, command: "pi", args: ["update", "npm:@rendotdev/lgtm"] }];
      }
      if (target === "claude") {
        return [
          {
            target,
            command: "claude",
            args: ["plugin", "marketplace", "update", "rendotdev"],
          },
          { target, command: "claude", args: ["plugin", "update", "lgtm@rendotdev"] },
        ];
      }
      return [
        {
          target,
          command: "codex",
          args: ["plugin", "marketplace", "upgrade", "rendotdev"],
        },
        { target, command: "codex", args: ["plugin", "add", "lgtm@rendotdev"] },
      ];
    }

    if (params.target !== "all") {
      return createUpdateSteps(params.target);
    }
    return (["pi", "claude", "codex"] as const).flatMap(createUpdateSteps);
  }

  public parseTarget(params: { value: string }): AgentInstallTarget | undefined {
    return agentInstallTargets.find((target) => target === params.value);
  }
}

export const AgentInstall = new AgentInstallService();
