export type CliUpdateStep = {
  command: string;
  args: string[];
};

export type CliUpdatePlan =
  | {
      status: "ready";
      currentVersion: string;
      latestVersion: string;
      step: CliUpdateStep;
    }
  | { status: "current"; version: string }
  | { status: "skipped"; reason: string };

export type CliUpdateResult =
  | {
      status: "updated";
      previousVersion: string;
      version: string;
      step: CliUpdateStep;
      output: string;
    }
  | { status: "current"; version: string }
  | { status: "skipped"; reason: string };
