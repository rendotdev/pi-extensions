import { spawn } from "node:child_process";
import { defineRepo } from "../../../../define.ts";
import type { SSHProcessResult } from "./ssh-types.ts";

export class SSHProcess extends defineRepo({
  params: { maximumOutputBytes: 100 * 1024 * 1024, timeoutMilliseconds: 30_000 },
  deps: { spawn },
}) {
  public async run(params: {
    args: string[];
    signal?: AbortSignal;
    maximumOutputBytes?: number;
  }): Promise<SSHProcessResult> {
    return await new Promise((resolvePromise, rejectPromise) => {
      const child = this.deps.spawn("ssh", params.args, {
        stdio: ["ignore", "pipe", "pipe"],
      });
      const stdout: Buffer[] = [];
      let stdoutBytes = 0;
      let stderr = "";
      let settled = false;
      const maximumOutputBytes = params.maximumOutputBytes ?? this.params.maximumOutputBytes;
      const timeout = setTimeout(() => {
        child.kill();
        finishWithError(new Error(`ssh timed out after ${this.params.timeoutMilliseconds}ms.`));
      }, this.params.timeoutMilliseconds);

      function cleanup() {
        clearTimeout(timeout);
        params.signal?.removeEventListener("abort", abort);
      }

      function finishWithError(error: Error) {
        if (settled) {
          return;
        }
        settled = true;
        cleanup();
        rejectPromise(error);
      }

      function abort() {
        child.kill();
        finishWithError(
          params.signal?.reason instanceof Error
            ? params.signal.reason
            : new DOMException("SSH command canceled.", "AbortError"),
        );
      }

      params.signal?.addEventListener("abort", abort, { once: true });
      if (params.signal?.aborted) {
        abort();
        return;
      }

      child.stdout?.on("data", (chunk: Buffer) => {
        stdoutBytes += chunk.length;
        if (stdoutBytes > maximumOutputBytes) {
          child.kill();
          finishWithError(
            new Error(`SSH response exceeds the ${maximumOutputBytes}-byte safety limit.`),
          );
          return;
        }
        stdout.push(chunk);
      });
      child.stderr?.on("data", (chunk: Buffer) => {
        stderr += chunk.toString("utf8");
      });
      child.once("error", finishWithError);
      child.once("exit", (code) => {
        if (settled) {
          return;
        }
        settled = true;
        cleanup();
        resolvePromise({ stdout: Buffer.concat(stdout), stderr, code });
      });
    });
  }
}
