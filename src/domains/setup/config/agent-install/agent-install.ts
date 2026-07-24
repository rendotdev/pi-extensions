import { defineConfig } from "../../../../define.ts";
import type { AgentInstallTarget } from "../../types/agent-install/agent-install.ts";

export const agentInstallTargets = defineConfig([
  "all",
  "pi",
  "claude",
  "codex",
] as const satisfies readonly AgentInstallTarget[]);
