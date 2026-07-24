export type AgentInstallTarget = "all" | "pi" | "claude" | "codex";

export type AgentInstallStep = {
  target: Exclude<AgentInstallTarget, "all">;
  command: string;
  args: string[];
};

export type AgentUpdateResult = {
  steps: AgentInstallStep[];
  skippedTargets: Exclude<AgentInstallTarget, "all">[];
  integrations: {
    target: Exclude<AgentInstallTarget, "all">;
    steps: AgentInstallStep[];
    outputs: string[];
  }[];
};

export type AgentUpdateEvent =
  | { phase: "started"; target: Exclude<AgentInstallTarget, "all"> }
  | {
      phase: "completed";
      target: Exclude<AgentInstallTarget, "all">;
      steps: AgentInstallStep[];
      outputs: string[];
    };
