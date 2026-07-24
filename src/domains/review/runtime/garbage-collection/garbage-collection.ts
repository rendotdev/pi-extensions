import { mkdir, readFile, readdir, rm, stat } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import { defineRuntime } from "../../../../define.ts";
import { SystemTime } from "../../../../providers/index.ts";
import { ReviewRetention } from "../../service/retention/retention.ts";

const cleanupLockName = ".cleanup-lock";
const cleanupLockStaleMilliseconds = 5 * 60 * 1_000;

export type ReviewGarbageCollectionResult = {
  removedAppDirs: string[];
  failures: Array<{ appDir: string; error: string }>;
  skippedBecauseLocked: boolean;
};

export class ReviewGarbageCollection extends defineRuntime({
  params: {},
  deps: {
    retentionPolicy: new ReviewRetention(),
    async stopServer(_appDir: string) {
      return false;
    },
  },
}) {
  public async cleanExpired(params: {
    root: string;
    excludeAppDir?: string;
    now?: Date;
  }): Promise<ReviewGarbageCollectionResult> {
    const root = resolve(params.root);
    const now = params.now ?? SystemTime.now({});
    await mkdir(root, { recursive: true });
    const lockPath = join(root, cleanupLockName);
    if (!(await acquireLock({ lockPath, now }))) {
      return { removedAppDirs: [], failures: [], skippedBecauseLocked: true };
    }

    try {
      const removedAppDirs: string[] = [];
      const failures: ReviewGarbageCollectionResult["failures"] = [];
      const excludeAppDir = params.excludeAppDir ? resolve(params.excludeAppDir) : undefined;
      const entries = await readdir(root, { withFileTypes: true });

      for (const entry of entries) {
        const shouldSkipEntry = !entry.isDirectory() || entry.name === cleanupLockName;
        if (shouldSkipEntry) {
          continue;
        }
        const appDir = resolve(root, entry.name);
        const shouldSkipDirectory = !appDir.startsWith(`${root}${sep}`) || appDir === excludeAppDir;
        if (shouldSkipDirectory) {
          continue;
        }
        const expiresAt = await readExpiresAt({
          appDir,
          retentionPolicy: this.deps.retentionPolicy,
        });
        const shouldKeepReview =
          !expiresAt || !this.deps.retentionPolicy.isExpired({ expiresAt, now });
        if (shouldKeepReview) {
          continue;
        }

        try {
          await this.deps.stopServer(appDir);
        } catch (error) {
          failures.push({ appDir, error: errorMessage({ error }) });
        }

        try {
          await rm(appDir, { force: true, recursive: true });
          removedAppDirs.push(appDir);
        } catch (error) {
          failures.push({ appDir, error: errorMessage({ error }) });
        }
      }

      return { removedAppDirs, failures, skippedBecauseLocked: false };
    } finally {
      await rm(lockPath, { force: true, recursive: true }).catch(
        function ignoreLockRemovalError() {},
      );
    }
  }
}

async function acquireLock(params: { lockPath: string; now: Date }): Promise<boolean> {
  try {
    await mkdir(params.lockPath);
    return true;
  } catch (error) {
    if (!isAlreadyExistsError({ error })) {
      throw error;
    }
  }
  try {
    const lockStats = await stat(params.lockPath);
    const isLockFresh = params.now.getTime() - lockStats.mtimeMs <= cleanupLockStaleMilliseconds;
    if (isLockFresh) {
      return false;
    }
    await rm(params.lockPath, { force: true, recursive: true });
    await mkdir(params.lockPath);
    return true;
  } catch {
    return false;
  }
}

async function readExpiresAt(params: {
  appDir: string;
  retentionPolicy: Pick<ReviewRetention, "expiresAt">;
}): Promise<string | undefined> {
  const manifest = await readObject({ path: join(params.appDir, "manifest.json") });
  if (typeof manifest?.expiresAt === "string") {
    return manifest.expiresAt;
  }
  const review = await readObject({ path: join(params.appDir, "review.json") });
  if (typeof review?.createdAt === "string") {
    return expirationFromCreatedAt({
      createdAt: review.createdAt,
      retentionPolicy: params.retentionPolicy,
    });
  }
  const payload = await readObject({ path: join(params.appDir, "payload.json") });
  return typeof payload?.generatedAt === "string"
    ? expirationFromCreatedAt({
        createdAt: payload.generatedAt,
        retentionPolicy: params.retentionPolicy,
      })
    : undefined;
}

function expirationFromCreatedAt(params: {
  createdAt: string;
  retentionPolicy: Pick<ReviewRetention, "expiresAt">;
}): string | undefined {
  try {
    return params.retentionPolicy.expiresAt({ createdAt: params.createdAt });
  } catch {
    return undefined;
  }
}

async function readObject(params: { path: string }): Promise<Record<string, unknown> | undefined> {
  try {
    const value = JSON.parse(await readFile(params.path, "utf8")) as unknown;
    const isObject = value && typeof value === "object" && !Array.isArray(value);
    return isObject ? (value as Record<string, unknown>) : undefined;
  } catch {
    return undefined;
  }
}

function isAlreadyExistsError(params: { error: unknown }): boolean {
  return (
    params.error instanceof Error &&
    "code" in params.error &&
    (params.error as NodeJS.ErrnoException).code === "EEXIST"
  );
}

function errorMessage(params: { error: unknown }): string {
  return params.error instanceof Error ? params.error.message : String(params.error);
}
