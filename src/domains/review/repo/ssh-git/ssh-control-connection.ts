import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defineRepo } from "../../../../define.ts";
import { SSHProcess } from "./ssh-process.ts";
import type { SSHControlConnection, SSHProcessResult } from "./ssh-types.ts";

export class SSHControlConnectionManager extends defineRepo({
  params: {},
  deps: {
    makeTemporaryDirectory: async function makeTemporaryDirectory(prefix: string): Promise<string> {
      return await mkdtemp(prefix);
    },
    removeDirectory: async function removeDirectory(path: string) {
      await rm(path, { force: true, recursive: true });
    },
    processRunner: new SSHProcess(),
  },
}) {
  public async open(params: {
    destination: string;
    signal?: AbortSignal;
  }): Promise<SSHControlConnection> {
    this.validateDestination({ destination: params.destination });
    const socketDirectory = await this.deps.makeTemporaryDirectory(join(tmpdir(), "lgtm-ssh-"));
    const connection = {
      destination: params.destination,
      socketDirectory,
      socketPath: join(socketDirectory, "control"),
    };
    try {
      const result = await this.deps.processRunner.run({
        args: [
          "-M",
          "-S",
          connection.socketPath,
          "-o",
          "ControlPersist=no",
          "-fN",
          "--",
          params.destination,
        ],
        signal: params.signal,
      });
      this.assertSuccess({ result, action: `connect to ${params.destination}` });
      return connection;
    } catch (error) {
      await this.deps.removeDirectory(socketDirectory).catch(() => undefined);
      throw error;
    }
  }

  public async execute(params: {
    connection: SSHControlConnection;
    command: string;
    marker: string;
    signal?: AbortSignal;
    maximumOutputBytes?: number;
  }): Promise<Buffer> {
    const result = await this.deps.processRunner.run({
      args: [
        "-S",
        params.connection.socketPath,
        "-T",
        "--",
        params.connection.destination,
        params.command,
      ],
      signal: params.signal,
      maximumOutputBytes: params.maximumOutputBytes,
    });
    this.assertSuccess({ result, action: `read from ${params.connection.destination}` });
    const frame = Buffer.from(`${params.marker}\n`);
    const frameIndex = result.stdout.indexOf(frame);
    if (frameIndex < 0) {
      throw new Error("SSH response did not contain the expected lgtm frame marker.");
    }
    return result.stdout.subarray(frameIndex + frame.length);
  }

  public async close(params: { connection: SSHControlConnection }): Promise<void> {
    await this.deps.processRunner
      .run({
        args: [
          "-S",
          params.connection.socketPath,
          "-O",
          "exit",
          "--",
          params.connection.destination,
        ],
      })
      .catch(() => undefined);
    await this.deps.removeDirectory(params.connection.socketDirectory).catch(() => undefined);
  }

  private validateDestination(params: { destination: string }) {
    const isInvalidDestination = !params.destination || params.destination.includes("\0");
    if (isInvalidDestination) {
      throw new Error("--remote requires a valid SSH destination.");
    }
  }

  private assertSuccess(params: { result: SSHProcessResult; action: string }) {
    if (params.result.code === 0) {
      return;
    }
    const details = params.result.stderr.trim();
    const prefix = params.result.code === 255 ? "SSH connection failed" : "Remote command failed";
    throw new Error(`${prefix} while trying to ${params.action}.${details ? `\n${details}` : ""}`);
  }
}
