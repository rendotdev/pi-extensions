export const agentInstallTargets = ["all", "pi", "claude", "codex"] as const;

export type AgentInstallTarget = (typeof agentInstallTargets)[number];

export type AgentInstallStep = {
  target: Exclude<AgentInstallTarget, "all">;
  command: string;
  args: string[];
};

export class AgentInstallPlannerClass {
  public createPlan(params: { target: AgentInstallTarget }): AgentInstallStep[] {
    if (params.target !== "all") return this.stepsFor(params.target);
    return (["pi", "claude", "codex"] as const).flatMap((target) => this.stepsFor(target));
  }

  private stepsFor(target: Exclude<AgentInstallTarget, "all">): AgentInstallStep[] {
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
}

export const agentInstallPlanner = new AgentInstallPlannerClass();

export function isAgentInstallTarget(value: string): value is AgentInstallTarget {
  return agentInstallTargets.includes(value as AgentInstallTarget);
}
