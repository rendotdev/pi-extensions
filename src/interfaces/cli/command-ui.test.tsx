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
        lines: ["Updated the LGTM CLI.", "Skipped uninstalled integrations: pi, claude."],
      }),
    ).toBe("✔ Updated the LGTM CLI.\n✔ Skipped uninstalled integrations: pi, claude.");
  });

  it("renders loading and completed integration states", () => {
    const view = render(<CommandUi state="loading" label="Updating LGTM integrations" />);

    expect(view.lastFrame()).toBe("⠋ Updating LGTM integrations");

    view.rerender(
      <CommandUi
        state="success"
        label="Updating LGTM integrations"
        detail="Updated LGTM integrations."
      />,
    );

    expect(view.lastFrame()).toBe("✔ Updating LGTM integrations\nUpdated LGTM integrations.");
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
      label: "Planning LGTM update",
      execute: async function execute() {
        return "Ready.";
      },
      renderSuccess: function renderSuccess(result) {
        return result;
      },
    });

    expect(writes).toEqual(["✔ Planning LGTM update\nReady.\n"]);
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
      label: "Updating LGTM",
      successLabel: "Updated LGTM",
      execute: async function execute() {
        return "  CLI: updated";
      },
      renderSuccess: function renderSuccess(result) {
        return result;
      },
    });

    expect(writes).toEqual(["✔ Updated LGTM\n  CLI: updated\n"]);
  });
});
