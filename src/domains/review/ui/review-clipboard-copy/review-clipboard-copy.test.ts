import { describe, expect, it, vi } from "vite-plus/test";
import { ReviewClipboardCopy } from "./review-clipboard-copy.ts";

describe("ReviewClipboardCopy", () => {
  it("starts before writing and finishes only after the clipboard resolves", async () => {
    let resolveWrite: (() => void) | undefined;
    const writeText = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveWrite = resolve;
        }),
    );
    const events: string[] = [];
    const ClipboardCopy = new ReviewClipboardCopy({ params: {}, deps: { writeText } });

    const copyPromise = ClipboardCopy.copy({
      text: "Review comments",
      onStart: () => events.push("started"),
      onFinish: () => events.push("finished"),
    });

    expect(events).toEqual(["started"]);
    expect(writeText).toHaveBeenCalledExactlyOnceWith("Review comments");

    resolveWrite?.();
    await expect(copyPromise).resolves.toBe(true);
    expect(events).toEqual(["started", "finished"]);
  });

  it("finishes the loading state when clipboard access fails", async () => {
    const events: string[] = [];
    const ClipboardCopy = new ReviewClipboardCopy({
      params: {},
      deps: {
        writeText: vi.fn(async () => {
          throw new Error("Clipboard unavailable");
        }),
      },
    });

    await expect(
      ClipboardCopy.copy({
        text: "Review comments",
        onStart: () => events.push("started"),
        onFinish: () => events.push("finished"),
      }),
    ).resolves.toBe(false);
    expect(events).toEqual(["started", "finished"]);
  });
});
