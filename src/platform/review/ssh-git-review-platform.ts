import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import { DomainClass } from "../../domain/domain-class.ts";
import type { DiffReviewFileInput, GitReviewSource } from "../../domain/review/review.ts";
import { ReviewSinceLastPlatform } from "./review-since-last-platform.ts";

type SSHProcessResult = {
  stdout: Buffer;
  stderr: string;
  code: number | null;
};

type SSHControlConnection = {
  destination: string;
  socketDirectory: string;
  socketPath: string;
};

export type RemoteGitReviewCollection = {
  files: DiffReviewFileInput[];
  checkpoint?: Array<{ location: string; content: string }>;
  source: GitReviewSource;
};

export class SSHCommandEncoderClass extends DomainClass<{ maximumCommandLength: number }, {}> {
  public quote(params: { value: string }): string {
    if (params.value.includes("\0")) {
      throw new Error("SSH command arguments cannot contain NUL bytes.");
    }
    return `'${params.value.replaceAll("'", `'"'"'`)}'`;
  }

  public executable(params: { marker: string; executable: string; args: string[] }): string {
    const command = [params.executable, ...params.args]
      .map((value) => this.quote({ value }))
      .join(" ");
    return this.validate({
      command: `printf '%s\\n' ${this.quote({ value: params.marker })}; exec ${command}`,
    });
  }

  public hasHead(params: { marker: string; root: string }): string {
    const root = this.quote({ value: params.root });
    const marker = this.quote({ value: params.marker });
    return this.validate({
      command: `if git -C ${root} rev-parse --verify HEAD >/dev/null 2>&1; then printf '%s\\ntrue' ${marker}; else printf '%s\\nfalse' ${marker}; fi`,
    });
  }

  public worktreeFile(params: { marker: string; path: string }): string {
    const path = this.quote({ value: params.path });
    const marker = this.quote({ value: params.marker });
    return this.validate({
      command: `printf '%s\\n' ${marker}; if [ -L ${path} ]; then readlink ${path}; else cat ${path}; fi`,
    });
  }

  private validate(params: { command: string }): string {
    if (Buffer.byteLength(params.command) > this.params.maximumCommandLength) {
      throw new Error(
        `SSH command exceeds the ${this.params.maximumCommandLength}-byte safety limit.`,
      );
    }
    return params.command;
  }
}

export class SSHProcessRunnerClass extends DomainClass<
  { maximumOutputBytes: number; timeoutMilliseconds: number },
  { spawn: typeof spawn }
> {
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

export class SSHControlConnectionClass extends DomainClass<
  {},
  {
    makeTemporaryDirectory: (prefix: string) => Promise<string>;
    removeDirectory: (path: string) => Promise<void>;
    processRunner: { run: SSHProcessRunnerClass["run"] };
  }
> {
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

export class SSHGitRepositoryReaderClass extends DomainClass<
  { fileConcurrency: number; maximumFileBytes: number },
  {
    commandEncoder: {
      executable: SSHCommandEncoderClass["executable"];
      hasHead: SSHCommandEncoderClass["hasHead"];
      worktreeFile: SSHCommandEncoderClass["worktreeFile"];
    };
    connection: {
      open: SSHControlConnectionClass["open"];
      execute: SSHControlConnectionClass["execute"];
      close: SSHControlConnectionClass["close"];
    };
    randomUUID: () => string;
    processRunner: { run: SSHProcessRunnerClass["run"] };
  }
> {
  public async collect(params: {
    localCwd: string;
    remote: string;
    remoteCwd: string;
    sessionId?: string;
    signal?: AbortSignal;
    sinceLast?: boolean;
  }): Promise<RemoteGitReviewCollection> {
    if (!isAbsolute(params.remoteCwd)) {
      throw new Error("--remote-cwd and remote worktree paths must be absolute.");
    }
    const endpoint = await this.describeEndpoint({
      destination: params.remote,
      signal: params.signal,
    });
    const connection = await this.deps.connection.open({
      destination: params.remote,
      signal: params.signal,
    });
    try {
      const root = (
        await this.runExecutable({
          connection,
          executable: "git",
          args: ["-C", params.remoteCwd, "rev-parse", "--show-toplevel"],
          signal: params.signal,
        })
      )
        .toString("utf8")
        .trim();
      if (!isAbsolute(root)) {
        throw new Error(`Remote Git root is not absolute: ${root || "(empty)"}.`);
      }
      const source: GitReviewSource = {
        kind: "git",
        transport: "ssh",
        key: `ssh://${endpoint.user}@${endpoint.hostname}:${endpoint.port}${root}`,
        label: `${params.remote}:${root}`,
      };
      const files = await this.collectFiles({ connection, root, signal: params.signal });
      if (!params.sinceLast) {
        this.assertFiles({ files, message: "No text changes were found to review." });
        return { files, source };
      }
      const collection = await ReviewSinceLastPlatform.collect({
        root,
        reviewRoots: [resolve(params.localCwd, ".lgtm")],
        currentFiles: files,
        sessionId: params.sessionId,
        sourceKey: source.key,
        readCurrentContent: async (location) =>
          (
            await this.readWorktreeFile({
              connection,
              root,
              location,
              signal: params.signal,
              allowMissing: true,
            })
          ).toString("utf8"),
      });
      this.assertFiles({
        files: collection.files,
        message: "No text changes were found since the last lgtm review.",
      });
      return {
        files: collection.files,
        checkpoint: collection.checkpoint,
        source,
      };
    } finally {
      await this.deps.connection.close({ connection });
    }
  }

  private async describeEndpoint(params: { destination: string; signal?: AbortSignal }) {
    const result = await this.deps.processRunner.run({
      args: ["-G", "--", params.destination],
      signal: params.signal,
    });
    if (result.code !== 0) {
      throw new Error(
        `Unable to resolve SSH destination ${params.destination}.${result.stderr ? `\n${result.stderr.trim()}` : ""}`,
      );
    }
    const settings = new Map<string, string>();
    for (const line of result.stdout.toString("utf8").split("\n")) {
      const separator = line.indexOf(" ");
      if (separator > 0) {
        settings.set(line.slice(0, separator), line.slice(separator + 1).trim());
      }
    }
    const hostname = settings.get("hostname");
    const user = settings.get("user");
    const port = settings.get("port") ?? "22";
    const isEndpointIncomplete = !hostname || !user;
    if (isEndpointIncomplete) {
      throw new Error(`ssh -G did not resolve a hostname and user for ${params.destination}.`);
    }
    const formattedHostname = hostname.includes(":") ? `[${hostname}]` : hostname;
    return { hostname: formattedHostname, user, port };
  }

  private async collectFiles(params: {
    connection: SSHControlConnection;
    root: string;
    signal?: AbortSignal;
  }): Promise<DiffReviewFileInput[]> {
    const hasHead =
      (
        await this.runCommand({
          connection: params.connection,
          command: this.deps.commandEncoder.hasHead({
            marker: this.nextMarker(),
            root: params.root,
          }),
          signal: params.signal,
        })
      )
        .toString("utf8")
        .trim() === "true";
    const changes: Array<{ oldPath?: string; newPath?: string }> = [];
    if (hasHead) {
      const status = await this.runExecutable({
        connection: params.connection,
        executable: "git",
        args: ["-C", params.root, "diff", "--name-status", "-z", "--find-renames", "HEAD", "--"],
        signal: params.signal,
      });
      changes.push(...this.parseNameStatus({ output: status.toString("utf8") }));
    } else {
      const paths = await this.runExecutable({
        connection: params.connection,
        executable: "git",
        args: ["-C", params.root, "ls-files", "--cached", "--others", "--exclude-standard", "-z"],
        signal: params.signal,
      });
      for (const path of paths.toString("utf8").split("\0").filter(Boolean)) {
        changes.push({ newPath: path });
      }
    }
    const untracked = await this.runExecutable({
      connection: params.connection,
      executable: "git",
      args: ["-C", params.root, "ls-files", "--others", "--exclude-standard", "-z"],
      signal: params.signal,
    });
    for (const path of untracked.toString("utf8").split("\0").filter(Boolean)) {
      changes.push({ newPath: path });
    }
    const deduplicated = new Map<string, { oldPath?: string; newPath?: string }>();
    for (const change of changes) {
      const key = change.newPath ?? change.oldPath;
      if (key) {
        deduplicated.set(key, change);
      }
    }
    const pending = [...deduplicated.values()];
    const files: DiffReviewFileInput[] = [];
    for (let index = 0; index < pending.length; index += this.params.fileConcurrency) {
      const batch = await Promise.all(
        pending.slice(index, index + this.params.fileConcurrency).map(async (change) => {
          const [oldContent, newContent] = await Promise.all([
            hasHead && change.oldPath
              ? this.readHeadFile({
                  connection: params.connection,
                  root: params.root,
                  location: change.oldPath,
                  signal: params.signal,
                })
              : Promise.resolve(Buffer.alloc(0)),
            change.newPath
              ? this.readWorktreeFile({
                  connection: params.connection,
                  root: params.root,
                  location: change.newPath,
                  signal: params.signal,
                })
              : Promise.resolve(Buffer.alloc(0)),
          ]);
          const isBinaryFile = oldContent.includes(0) || newContent.includes(0);
          if (isBinaryFile) {
            return undefined;
          }
          return {
            location: change.newPath ?? change.oldPath ?? "unknown",
            oldContent: oldContent.toString("utf8"),
            newContent: newContent.toString("utf8"),
          };
        }),
      );
      files.push(...batch.filter((file): file is DiffReviewFileInput => Boolean(file)));
    }
    return files;
  }

  private async readHeadFile(params: {
    connection: SSHControlConnection;
    root: string;
    location: string;
    signal?: AbortSignal;
  }): Promise<Buffer> {
    try {
      return await this.runExecutable({
        connection: params.connection,
        executable: "git",
        args: ["-C", params.root, "show", `HEAD:${params.location}`],
        signal: params.signal,
        maximumOutputBytes: this.params.maximumFileBytes,
      });
    } catch {
      return Buffer.alloc(0);
    }
  }

  private async readWorktreeFile(params: {
    connection: SSHControlConnection;
    root: string;
    location: string;
    signal?: AbortSignal;
    allowMissing?: boolean;
  }): Promise<Buffer> {
    this.assertSafeLocation({ root: params.root, location: params.location });
    const path = resolve(params.root, params.location);
    const marker = this.nextMarker();
    try {
      return await this.runCommand({
        connection: params.connection,
        command: this.deps.commandEncoder.worktreeFile({ marker, path }),
        marker,
        signal: params.signal,
        maximumOutputBytes: this.params.maximumFileBytes,
      });
    } catch (error) {
      if (params.allowMissing) {
        return Buffer.alloc(0);
      }
      throw error;
    }
  }

  private async runExecutable(params: {
    connection: SSHControlConnection;
    executable: string;
    args: string[];
    signal?: AbortSignal;
    maximumOutputBytes?: number;
  }) {
    const marker = this.nextMarker();
    return await this.runCommand({
      connection: params.connection,
      command: this.deps.commandEncoder.executable({
        marker,
        executable: params.executable,
        args: params.args,
      }),
      marker,
      signal: params.signal,
      maximumOutputBytes: params.maximumOutputBytes,
    });
  }

  private async runCommand(params: {
    connection: SSHControlConnection;
    command: string;
    marker?: string;
    signal?: AbortSignal;
    maximumOutputBytes?: number;
  }) {
    const marker = params.marker ?? this.markerFromCommand({ command: params.command });
    return await this.deps.connection.execute({
      connection: params.connection,
      command: params.command,
      marker,
      signal: params.signal,
      maximumOutputBytes: params.maximumOutputBytes,
    });
  }

  private markerFromCommand(params: { command: string }) {
    const match = params.command.match(/LGTM_FRAME_[a-zA-Z0-9-]+/);
    if (!match) {
      throw new Error("SSH command is missing its frame marker.");
    }
    return match[0];
  }

  private nextMarker() {
    return `LGTM_FRAME_${this.deps.randomUUID()}`;
  }

  private parseNameStatus(params: { output: string }) {
    const fields = params.output.split("\0").filter(Boolean);
    const changes: Array<{ oldPath?: string; newPath?: string }> = [];
    for (let index = 0; index < fields.length; index += 1) {
      const status = fields[index];
      const path = fields[index + 1] ?? "";
      index += 1;
      const kind = status.charAt(0);
      const isRenameOrCopy = kind === "R" || kind === "C";
      if (isRenameOrCopy) {
        const newPath = fields[index + 1] ?? "";
        index += 1;
        changes.push({ oldPath: path, newPath });
      } else if (kind === "A") {
        changes.push({ newPath: path });
      } else if (kind === "D") {
        changes.push({ oldPath: path });
      } else {
        changes.push({ oldPath: path, newPath: path });
      }
    }
    return changes.filter((change) => change.oldPath || change.newPath);
  }

  private assertSafeLocation(params: { root: string; location: string }) {
    const isUnsafeLocation =
      !params.location || isAbsolute(params.location) || params.location.includes("\0");
    if (isUnsafeLocation) {
      throw new Error(`Unsafe remote Git path: ${params.location || "(empty)"}.`);
    }
    const path = resolve(params.root, params.location);
    const escapesRepository = path !== params.root && !path.startsWith(`${params.root}/`);
    if (escapesRepository) {
      throw new Error(`Remote Git path escapes the repository: ${params.location}.`);
    }
  }

  private assertFiles(params: { files: DiffReviewFileInput[]; message: string }) {
    if (params.files.length === 0) {
      throw new Error(params.message);
    }
  }
}

export const SSHCommandEncoder = new SSHCommandEncoderClass({ maximumCommandLength: 65_536 }, {});
export const SSHProcessRunner = new SSHProcessRunnerClass(
  { maximumOutputBytes: 100 * 1024 * 1024, timeoutMilliseconds: 30_000 },
  { spawn },
);
export const SSHControlConnection = new SSHControlConnectionClass(
  {},
  {
    makeTemporaryDirectory: mkdtemp,
    removeDirectory: async function removeDirectory(path) {
      await rm(path, { force: true, recursive: true });
    },
    processRunner: SSHProcessRunner,
  },
);
export const SSHGitRepositoryReader = new SSHGitRepositoryReaderClass(
  { fileConcurrency: 6, maximumFileBytes: 50 * 1024 * 1024 },
  {
    commandEncoder: SSHCommandEncoder,
    connection: SSHControlConnection,
    randomUUID,
    processRunner: SSHProcessRunner,
  },
);
