import { stopReviews } from "../../../domains/review/index.ts";

export function registerCancellationHandlers(params: {
  controller: AbortController;
  cwd: string;
}): void {
  let cancelling = false;
  async function cancel() {
    if (cancelling) {
      return;
    }
    cancelling = true;
    params.controller.abort();
    await stopReviews(params.cwd).catch(() => false);
  }

  process.once("SIGINT", () => {
    void cancel().finally(() => process.exit(130));
  });
  process.once("SIGTERM", () => {
    void cancel().finally(() => process.exit(143));
  });
}
