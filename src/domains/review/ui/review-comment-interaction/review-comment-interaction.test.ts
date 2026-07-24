import { describe, expect, it } from "vite-plus/test";
import { ReviewCommentInteraction } from "./review-comment-interaction.ts";

function interaction(params: { runTimeout?: boolean; timeoutCallbacks?: Array<() => void> } = {}) {
  return new ReviewCommentInteraction({
    params: {
      minimumTextareaHeight: 44,
      cleanupByNode: new WeakMap(),
      pointerCleanupByNode: new WeakMap(),
    },
    deps: {
      cancelAnimationFrame: function cancelAnimationFrame() {},
      documentSelection: () => null,
      now: () => 42,
      random: () => 0.5,
      randomUUID: undefined,
      requestAnimationFrame: function requestAnimationFrame(callback) {
        callback(0);
        return 1;
      },
      setTimeout: function setTimeout(callback) {
        if (params.timeoutCallbacks) {
          params.timeoutCallbacks.push(callback);
        } else if (params.runTimeout) {
          callback();
        }
        return 1;
      },
    },
  });
}

describe("ReviewCommentInteraction", () => {
  it("creates deterministic fallback IDs from injected dependencies", () => {
    expect(interaction().createId({})).toBe("comment-42-8");
  });

  it("reads selected source lines from the requested diff side", () => {
    expect(
      interaction().selectedText({
        file: {
          id: "file",
          location: "file.ts",
          language: "typescript",
          oldContent: "old one\nold two",
          newContent: "new one\nnew two",
          added: 2,
          removed: 2,
        },
        side: "additions",
        startLine: 2,
        endLine: 2,
      }),
    ).toBe("new two");
  });

  it("resizes textareas with the configured minimum height", () => {
    const textarea = { style: { height: "" }, scrollHeight: 20 } as HTMLTextAreaElement;

    interaction().resizeTextarea({ textarea });

    expect(textarea.style.height).toBe("44px");
  });

  it("does not rewrite an unchanged textarea height while typing", () => {
    let height = "44px";
    let writes = 0;
    const style = {} as CSSStyleDeclaration;
    Object.defineProperty(style, "height", {
      get: () => height,
      set: (value: string) => {
        height = value;
        writes += 1;
      },
    });
    const textarea = { style, scrollHeight: 44 } as HTMLTextAreaElement;

    interaction().resizeTextarea({ textarea });

    expect(writes).toBe(0);
    expect(textarea.style.height).toBe("44px");
  });

  it("defers an empty comment finish until an active pointer interaction completes", () => {
    const node = new EventTarget();
    const finishes: string[] = [];
    const CommentInteraction = interaction({ runTimeout: true });
    CommentInteraction.installPointerTracking({ node, phase: "mount" });

    node.dispatchEvent(new Event("pointerdown"));
    CommentInteraction.finishAfterPointerInteraction({
      callback: function finishComment() {
        finishes.push("finished");
      },
    });

    expect(finishes).toEqual([]);
    node.dispatchEvent(new Event("pointerup"));
    expect(finishes).toEqual(["finished"]);
  });

  it("finishes an empty comment after queued text-selection work", () => {
    const node = new EventTarget();
    const callbacks: Array<() => void> = [];
    const events: string[] = [];
    const CommentInteraction = interaction({ timeoutCallbacks: callbacks });
    CommentInteraction.installPointerTracking({ node, phase: "mount" });

    node.dispatchEvent(new Event("pointerdown"));
    CommentInteraction.finishAfterPointerInteraction({
      callback: function finishComment() {
        events.push("finish");
      },
    });
    node.dispatchEvent(new Event("pointerup"));
    callbacks.push(function addTextSelectionComment() {
      events.push("selection");
    });
    while (callbacks.length > 0) {
      callbacks.shift()?.();
    }

    expect(events).toEqual(["selection", "finish"]);
  });

  it("restores the selected diff line after a virtualized layout change", () => {
    let lineSelector = "";
    function line(top: number) {
      return {
        getAttribute: (name: string) =>
          name === "data-line-type" ? "change-addition" : name === "data-line" ? "5" : "4,4",
        getBoundingClientRect: () => ({ top }),
      } as unknown as HTMLElement;
    }
    let root = {
      querySelectorAll: (selector: string) => {
        lineSelector = selector;
        return [line(120)];
      },
    } as unknown as ShadowRoot;
    const scrollElement = { scrollTop: 500 } as HTMLElement;
    const node = {
      get shadowRoot() {
        return root;
      },
      closest: () => scrollElement,
    } as unknown as HTMLElement;
    const anchor = interaction().captureDiffScrollAnchor({
      node,
      range: { start: 5, end: 5, side: "additions", endSide: "additions" },
    });

    expect(anchor?.top).toBe(120);
    expect(lineSelector).toContain('data-column-number="5"');
    root = { querySelectorAll: () => [line(156)] } as unknown as ShadowRoot;
    if (anchor) {
      interaction().restoreDiffScrollAnchor({ anchor });
    }

    expect(scrollElement.scrollTop).toBe(536);
  });

  it("anchors a side-by-side context line by its requested source-side index", () => {
    const contextLines = [
      { top: 562, lineIndex: "287,264" },
      { top: 350, lineIndex: "282,259" },
    ].map(
      ({ top, lineIndex }) =>
        ({
          getAttribute: (name: string) =>
            name === "data-line-index" ? lineIndex : name === "data-line-type" ? "context" : null,
          getBoundingClientRect: () => ({ top }),
        }) as unknown as HTMLElement,
    );
    const scrollElement = { scrollTop: 1_000 } as HTMLElement;
    const node = {
      shadowRoot: null,
      closest: () => scrollElement,
      querySelectorAll: () => contextLines,
    } as unknown as HTMLElement;

    const anchor = interaction().captureDiffScrollAnchor({
      node,
      range: { start: 260, end: 260, side: "additions", endSide: "additions" },
    });

    expect(anchor?.top).toBe(350);
  });

  it("restores a selected document block after focus scrolls its container", () => {
    let blockTop = 220;
    const block = {
      getBoundingClientRect: () => ({ top: blockTop }),
    } as unknown as HTMLElement;
    const scrollElement = { scrollTop: 1_000 } as HTMLElement;
    const anchor = interaction().captureElementScrollAnchor({
      element: block,
      scrollElement,
    });

    blockTop = -328;
    interaction().restoreElementScrollAnchor({ anchor });

    expect(scrollElement.scrollTop).toBe(452);
  });

  it("reads only the document source rows intersected by a selection", () => {
    const lines = [11, 13, 14].map(
      (lineNumber) => ({ dataset: { documentLine: String(lineNumber) } }) as unknown as HTMLElement,
    );
    const root = {
      querySelectorAll: () => lines,
    } as unknown as HTMLElement;
    const range = {
      intersectsNode: (element: Node) => element === lines[1],
    } as unknown as Range;

    expect(interaction().selectedDocumentLineRange({ root, range })).toEqual({
      startLine: 13,
      endLine: 13,
    });
  });
});
