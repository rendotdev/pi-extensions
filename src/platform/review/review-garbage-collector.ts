import { mkdir, readFile, readdir, rm, stat } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import { DomainClass } from "../../domain/domain-class.ts";
import { ReviewRetentionPolicyClass } from "../../domain/review/review-retention.ts";

const cleanupLockName = ".cleanup-lock";
const cleanupLockStaleMilliseconds = 5 * 60 * 1_000;

export type ReviewGarbageCollectionResult = {
  removedAppDirs: string[];
  failures: Array<{ appDir: string; error: string }>;
  skippedBecauseLocked: boolean;
};

export class ReviewGarbageCollectorClass extends DomainClass<
  {},
  {
    retentionPolicy: ReviewRetentionPolicyClass;
    stopServer: (appDir: string) => Promise<boolean>;
  }
> {
  public async cleanExpired(params: {
    root: string;
    excludeAppDir?: string;
    now?: Date;
  }): Promise<ReviewGarbageCollectionResult> {
    const root = resolve(params.root);
    const now = params.now ?? new Date();
    await mkdir(root, { recursive: true });
    const lockPath = join(root, cleanupLockName);
    if (!(await this.acquireLock({ lockPath, now }))) {
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
        const expiresAt = await this.readExpiresAt({ appDir });
        const shouldKeepReview =
          !expiresAt || !this.deps.retentionPolicy.isExpired({ expiresAt, now });
        if (shouldKeepReview) {
          continue;
        }

        try {
          await this.deps.stopServer(appDir);
        } catch (error) {
          failures.push({ appDir, error: this.errorMessage({ error }) });
        }

        try {
          await rm(appDir, { force: true, recursive: true });
          removedAppDirs.push(appDir);
        } catch (error) {
          failures.push({ appDir, error: this.errorMessage({ error }) });
        }
      }

      return { removedAppDirs, failures, skippedBecauseLocked: false };
    } finally {
      await rm(lockPath, { force: true, recursive: true }).catch(
        function ignoreLockRemovalError() {},
      );
    }
  }

  private async acquireLock(params: { lockPath: string; now: Date }): Promise<boolean> {
    try {
      await mkdir(params.lockPath);
      return true;
    } catch (error) {
      if (!this.isAlreadyExistsError({ error })) {
        throw error;
      }
    }

    try {
      const lockStats = await stat(params.lockPath);
      if (params.now.getTime() - lockStats.mtimeMs <= cleanupLockStaleMilliseconds) {
        return false;
      }
      await rm(params.lockPath, { force: true, recursive: true });
      await mkdir(params.lockPath);
      return true;
    } catch {
      return false;
    }
  }

  private async readExpiresAt(params: { appDir: string }): Promise<string | undefined> {
    const manifest = await this.readObject({ path: join(params.appDir, "manifest.json") });
    if (typeof manifest?.expiresAt === "string") {
      return manifest.expiresAt;
    }

    const review = await this.readObject({ path: join(params.appDir, "review.json") });
    if (typeof review?.createdAt === "string") {
      try {
        return this.deps.retentionPolicy.expiresAt({ createdAt: review.createdAt });
      } catch {
        return undefined;
      }
    }

    const payload = await this.readObject({ path: join(params.appDir, "payload.json") });
    if (typeof payload?.generatedAt === "string") {
      try {
        return this.deps.retentionPolicy.expiresAt({ createdAt: payload.generatedAt });
      } catch {
        return undefined;
      }
    }
    return undefined;
  }

  private async readObject(params: { path: string }): Promise<Record<string, unknown> | undefined> {
    try {
      const value = JSON.parse(await readFile(params.path, "utf8")) as unknown;
      return value && typeof value === "object" && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : undefined;
    } catch {
      return undefined;
    }
  }

  private isAlreadyExistsError(params: { error: unknown }): boolean {
    return (
      params.error instanceof Error &&
      "code" in params.error &&
      (params.error as NodeJS.ErrnoException).code === "EEXIST"
    );
  }

  private errorMessage(params: { error: unknown }): string {
    return params.error instanceof Error ? params.error.message : String(params.error);
  }
}
