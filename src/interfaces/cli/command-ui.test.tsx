import { cleanup, render } from "ink-testing-library";
import { afterEach, describe, expect, it } from "vite-plus/test";
import { CommandUi, CommandUiRendererClass } from "./command-ui.tsx";

afterEach(cleanup);

describe("CommandUiRendererClass", () => {
  it("formats completed integration details as a checklist", () => {
    const Renderer = new CommandUiRendererClass(
      {},
      {
        stdout: process.stdout,
        render: function renderUnexpectedly() {
          throw new Error("The non-interactive test must not render an Ink app.");
        },
      },
    );

    expect(
      Renderer.formatChecklist({
        lines: ["Updated the lgtm CLI.", "Skipped uninstalled integrations: pi, claude."],
      }),
    ).toBe("✔ Updated the lgtm CLI.\n✔ Skipped uninstalled integrations: pi, claude.");
  });

  it("formats the installed and latest CLI versions", () => {
    const Renderer = new CommandUiRendererClass(
      {},
      {
        stdout: process.stdout,
        render: function renderUnexpectedly() {
          throw new Error("The non-interactive test must not render an Ink app.");
        },
      },
    );

    expect(
      Renderer.formatIntegrationResult({
        action: "update",
        target: "all",
        steps: [],
        cli: {
          status: "updated",
          previousVersion: "0.1.12",
          version: "0.2.0",
          step: { command: "npm", args: [] },
          output: "",
        },
      }),
    ).toBe("  CLI: updated from 0.1.12 to 0.2.0");

    expect(
      Renderer.formatIntegrationResult({
        action: "update",
        target: "all",
        steps: [],
        cli: { status: "current", version: "0.2.0" },
      }),
    ).toBe("  CLI: already current at 0.2.0");
  });

  it("renders loading and completed integration states", () => {
    const view = render(<CommandUi state="loading" label="Updating lgtm integrations" />);

    expect(view.lastFrame()).toBe("⠋ Updating lgtm integrations");

    view.rerender(
      <CommandUi
        state="success"
        label="Updating lgtm integrations"
        detail="Updated lgtm integrations."
      />,
    );

    expect(view.lastFrame()).toBe("✔ Updating lgtm integrations\nUpdated lgtm integrations.");
  });

  it("prints one stable result when stdout is not interactive", async () => {
    const writes: string[] = [];
    const Renderer = new CommandUiRendererClass(
      {},
      {
        stdout: {
          isTTY: false,
          write: function write(value) {
            writes.push(String(value));
            return true;
          },
        },
        render: function renderUnexpectedly() {
          throw new Error("The non-interactive test must not render an Ink app.");
        },
      },
    );

    await Renderer.run({
      label: "Planning lgtm update",
      execute: async function execute() {
        return "Ready.";
      },
      renderSuccess: function renderSuccess(result) {
        return result;
      },
    });

    expect(writes).toEqual(["✔ Planning lgtm update\nReady.\n"]);
  });

  it("replaces an in-progress label with a completed action", async () => {
    const writes: string[] = [];
    const Renderer = new CommandUiRendererClass(
      {},
      {
        stdout: {
          isTTY: false,
          write: function write(value) {
            writes.push(String(value));
            return true;
          },
        },
        render: function renderUnexpectedly() {
          throw new Error("The non-interactive test must not render an Ink app.");
        },
      },
    );

    await Renderer.run({
      label: "Updating lgtm",
      successLabel: "Updated lgtm",
      execute: async function execute() {
        return "  CLI: updated";
      },
      renderSuccess: function renderSuccess(result) {
        return result;
      },
    });

    expect(writes).toEqual(["✔ Updated lgtm\n  CLI: updated\n"]);
  });

  it("renders completed update steps and indented subprocess logs", async () => {
    const writes: string[] = [];
    const Renderer = new CommandUiRendererClass(
      {},
      {
        stdout: {
          isTTY: false,
          write: function write(value) {
            writes.push(String(value));
            return true;
          },
        },
        render: function renderUnexpectedly() {
          throw new Error("The non-interactive test must not render an Ink app.");
        },
      },
    );

    await Renderer.run({
      label: "Preparing lgtm update",
      successLabel: "Update finished",
      execute: async function execute(report) {
        report.complete({ label: "Current version: 0.1.12" });
        report("Checking for updates");
        report.complete({ label: "Update available: 0.1.12 to 0.2.0" });
        report("Updating CLI");
        report.complete({
          label: "Updated CLI: 0.1.12 to 0.2.0",
          detail: Renderer.formatLogGroup({ outputs: ["added 1 package\nchanged 1 package\n"] }),
        });
        report("Updating integration: Claude Code");
        report.complete({
          label: "Updating integration: Claude Code",
          detail: Renderer.formatLogGroup({ outputs: ["Updated marketplace.\n"] }),
        });
        return undefined;
      },
      renderSuccess: function renderSuccess() {
        return "Restart your agent session to reload lgtm integrations, or use the lgtm CLI now.";
      },
    });

    expect(writes).toEqual([
      [
        "✔ Current version: 0.1.12",
        "✔ Update available: 0.1.12 to 0.2.0",
        "✔ Updated CLI: 0.1.12 to 0.2.0",
        "  Logs:",
        "    added 1 package",
        "    changed 1 package",
        "✔ Updating integration: Claude Code",
        "  Logs:",
        "    Updated marketplace.",
        "✔ Update finished",
        "Restart your agent session to reload lgtm integrations, or use the lgtm CLI now.",
        "",
      ].join("\n"),
    ]);
  });
});
