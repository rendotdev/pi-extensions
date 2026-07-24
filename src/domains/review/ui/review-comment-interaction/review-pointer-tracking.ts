import { defineRuntime } from "../../../../define.ts";

export class ReviewPointerTracking extends defineRuntime({
  params: { cleanupByNode: new WeakMap<EventTarget, () => void>() },
  deps: {
    setTimeout: function scheduleTimeout(callback: () => void, milliseconds: number): number {
      return globalThis.setTimeout(callback, milliseconds) as unknown as number;
    },
  },
}) {
  private isInteractionActive = false;
  private readonly releaseCallbacks = new Set<() => void>();

  public finishAfterPointerInteraction(params: { callback: () => void }): void {
    if (this.isInteractionActive) {
      this.releaseCallbacks.add(params.callback);
      return;
    }
    params.callback();
  }

  public installPointerTracking(params: { node: EventTarget; phase: string }): void {
    if (params.phase === "unmount") {
      this.params.cleanupByNode.get(params.node)?.();
      this.params.cleanupByNode.delete(params.node);
      this.isInteractionActive = false;
      this.releaseCallbacks.clear();
      return;
    }
    if (this.params.cleanupByNode.has(params.node)) {
      return;
    }
    const beginPointerInteraction = () => {
      this.isInteractionActive = true;
    };
    const finishPointerInteraction = () => {
      this.finishCurrentInteraction();
    };
    params.node.addEventListener("pointerdown", beginPointerInteraction, true);
    params.node.addEventListener("pointercancel", finishPointerInteraction, true);
    params.node.addEventListener("pointerup", finishPointerInteraction, true);
    this.params.cleanupByNode.set(params.node, () => {
      params.node.removeEventListener("pointerdown", beginPointerInteraction, true);
      params.node.removeEventListener("pointercancel", finishPointerInteraction, true);
      params.node.removeEventListener("pointerup", finishPointerInteraction, true);
    });
  }

  private finishCurrentInteraction(): void {
    if (!this.isInteractionActive) {
      return;
    }
    this.isInteractionActive = false;
    const callbacks = Array.from(this.releaseCallbacks);
    this.releaseCallbacks.clear();
    this.deps.setTimeout(() => {
      this.deps.setTimeout(() => {
        for (const callback of callbacks) {
          callback();
        }
      }, 0);
    }, 0);
  }
}
