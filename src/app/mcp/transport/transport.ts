import { createInterface } from "node:readline";
import { defineApp } from "../../../define.ts";
import { createMcpMessageHandler } from "../message-handler/message-handler.ts";

export async function runMcpServer(): Promise<void> {
  await defineApp({
    params: {},
    deps: { createInterface, createMcpMessageHandler },
    async run() {
      const lines = this.deps.createInterface({
        input: process.stdin,
        crlfDelay: Number.POSITIVE_INFINITY,
      });
      const server = this.deps.createMcpMessageHandler(function send(value) {
        process.stdout.write(`${JSON.stringify(value)}\n`);
      });
      for await (const line of lines) {
        server.handleLine(line);
      }
      server.close();
    },
  });
}
