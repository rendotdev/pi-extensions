import { describe, expect, it, vi } from "vite-plus/test";
import { CommandUiRendererClass } from "./command-ui.ts";

describe("CommandUiRendererClass", () => {
  it("formats completed integration details as a checklist", () => {
    const renderer = new CommandUiRendererClass(
      {},
      {
        stdout: process.stdout,
        setInterval: globalThis.setInterval,
        clearInterval: globalThis.clearInterval,
      },
    );

    expect(
      renderer.formatChecklist({
        lines: ["Updated the LGTM CLI.", "Skipped uninstalled integrations: pi, claude."],
      }),
    ).toBe("✔ Updated the LGTM CLI.\n✔ Skipped uninstalled integrations: pi, claude.");
  });

  it("updates one terminal line while loading and replaces it with the result", async () => {
    const writes: string[] = [];
    let tick: () => void = () => undefined;
    const clearInterval = vi.fn();
    const renderer = new CommandUiRendererClass(
      {},
      {
        stdout: {
          isTTY: true,
          write: (value) => {
            writes.push(String(value));
            return true;
          },
        },
        setInterval: (callback) => {
          tick = callback;
          return 1 as unknown as ReturnType<typeof setInterval>;
        },
        clearInterval,
      },
    );

    await renderer.run({
      label: "Updating LGTM integrations",
      execute: async (report) => {
        tick();
        report("Installing LGTM CLI");
        return "Updated LGTM integrations.";
      },
      renderSuccess: (result) => result,
    });

    expect(writes).toEqual([
      "\r\u001B[2K\u001B[36m⠋ Updating LGTM integrations\u001B[39m",
      "\r\u001B[2K\u001B[36m⠙ Updating LGTM integrations\u001B[39m",
      "\r\u001B[2K\u001B[36m⠙ Installing LGTM CLI\u001B[39m",
      "\r\u001B[2K\u001B[32m✔ Updating LGTM integrations\u001B[39m",
      "\nUpdated LGTM integrations.\n",
    ]);
    expect(clearInterval).toHaveBeenCalledOnce();
  });

  it("prints one stable result when stdout is not interactive", async () => {
    const writes: string[] = [];
    const renderer = new CommandUiRendererClass(
      {},
      {
        stdout: {
          isTTY: false,
          write: (value) => {
            writes.push(String(value));
            return true;
          },
        },
        setInterval: globalThis.setInterval,
        clearInterval: globalThis.clearInterval,
      },
    );

    await renderer.run({
      label: "Planning LGTM update",
      execute: async () => "Ready.",
      renderSuccess: (result) => result,
    });

    expect(writes).toEqual(["✔ Planning LGTM update\nReady.\n"]);
  });
});
