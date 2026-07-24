import { defineRuntime } from "../../../../define.ts";

export class ReviewClipboardCopy extends defineRuntime({
  params: {},
  deps: {
    async writeText(text: string) {
      await navigator.clipboard.writeText(text);
    },
  },
}) {
  public async copy(params: {
    text: string;
    onStart: () => void;
    onFinish: () => void;
  }): Promise<boolean> {
    params.onStart();
    try {
      await this.deps.writeText(params.text);
      return true;
    } catch {
      return false;
    } finally {
      params.onFinish();
    }
  }
}
