import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { createServer, type ServerResponse } from "node:http";
import { extname, join, resolve, sep } from "node:path";
import process from "node:process";
import { PreferencesService, PreferencesStore } from "../../../settings/index.ts";
import { ReviewRetention } from "../../service/retention/retention.ts";
import { reviewManifestSchema, reviewPayloadSchema } from "../../types/schemas/schemas.ts";
import type { ReviewJson, ReviewManifest, ReviewPayload } from "../../types/review.ts";
import { ReviewApiRouter } from "../api/router/router.ts";
import { ReviewExpiration } from "../expiration/expiration.ts";
import { ReviewGarbageCollection } from "../garbage-collection/garbage-collection.ts";
import { stopReviewServerForAppDir } from "./server-process.ts";
import { WebRoot } from "./server-paths.ts";

const reviewGarbageCollection = new ReviewGarbageCollection({
  params: {},
  deps: { retentionPolicy: new ReviewRetention(), stopServer: stopReviewServerForAppDir },
});

export async function writeReviewApp(
  appDir: string,
  payload: ReviewPayload,
  review: ReviewJson,
  manifest: ReviewManifest,
) {
  await mkdir(appDir, { recursive: true });
  await Promise.all([
    writeFile(join(appDir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8"),
    writeFile(join(appDir, "payload.json"), `${JSON.stringify(payload, null, 2)}\n`, "utf8"),
    writeFile(join(appDir, "review.json"), `${JSON.stringify(review, null, 2)}\n`, "utf8"),
  ]);
}

export async function serveReviewAppImplementation(appDirInput: string): Promise<void> {
  const appDir = resolve(appDirInput);
  const context = await loadServerContext(appDir);
  const server = createReviewHttpServer(context);
  scheduleExpiration({ appDir, expiresAt: context.manifest.expiresAt, server });
  await listenForReview(server);
  void cleanExpiredReviews({ appDir, cwd: context.payload.cwd });
}

async function loadServerContext(appDir: string) {
  const payloadPath = join(appDir, "payload.json");
  const reviewPath = join(appDir, "review.json");
  const payload = reviewPayloadSchema.parse(await readJsonFile<ReviewPayload>(payloadPath));
  const manifest = reviewManifestSchema.parse(
    await readJsonFile<ReviewManifest>(join(appDir, "manifest.json")),
  );
  const preferencesStore = new PreferencesStore({
    params: { cwd: payload.cwd },
    deps: {},
  });
  const preferences = new PreferencesService({
    params: { defaults: new PreferencesService().defaults },
    deps: { preferencesStore },
  });
  const webRoot = await new WebRoot().resolve({});
  return { manifest, payload, payloadPath, preferences, reviewPath, webRoot };
}

function createReviewHttpServer(context: Awaited<ReturnType<typeof loadServerContext>>) {
  let server: ReturnType<typeof createServer>;
  const ApiRouter = new ReviewApiRouter({
    params: { payloadPath: context.payloadPath, reviewPath: context.reviewPath },
    deps: {
      preferences: context.preferences,
      closeServer: function closeServer() {
        server.close(function exitServer() {
          process.exit(0);
        });
        const forceExit = setTimeout(function forceExitServer() {
          process.exit(0);
        }, 1_000);
        forceExit.unref();
      },
    },
  });

  server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url ?? "/", "http://localhost");

      if (await ApiRouter.handle({ request, response, url })) {
        return;
      }

      if (request.method === "GET") {
        return await sendStaticFile(response, context.webRoot, url.pathname);
      }

      ApiRouter.sendError({ response, status: 404, error: "Not found." });
    } catch (error) {
      ApiRouter.sendError({ response, status: 400, error });
    }
  });
  return server;
}

function scheduleExpiration(params: {
  appDir: string;
  expiresAt: string;
  server: ReturnType<typeof createServer>;
}) {
  async function expireReview() {
    await rm(params.appDir, { force: true, recursive: true });
    params.server.close(function exitExpiredReview() {
      process.exit(0);
    });
    params.server.closeAllConnections();
    const forceExit = setTimeout(() => process.exit(0), 1_000);
    forceExit.unref();
  }

  const ExpirationScheduler = new ReviewExpiration({
    params: { expiresAt: params.expiresAt },
    deps: {
      now: function now() {
        return new Date();
      },
      onError: function reportExpirationError(error) {
        process.stderr.write(
          `LGTM review expiration failed: ${error instanceof Error ? error.message : String(error)}\n`,
        );
      },
      onExpire: expireReview,
      setTimer: setTimeout,
    },
  });
  ExpirationScheduler.schedule({});
}

async function listenForReview(server: ReturnType<typeof createServer>) {
  await new Promise<void>((resolvePromise, rejectPromise) => {
    server.once("error", rejectPromise);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const isInvalidAddress = !address || typeof address === "string";
      if (isInvalidAddress) {
        rejectPromise(new Error("LGTM review server did not receive a TCP port."));
        return;
      }
      console.log(`LGTM_REVIEW_URL=http://localhost:${address.port}/`);
      resolvePromise();
    });
  });
}

async function cleanExpiredReviews(params: { appDir: string; cwd: string }) {
  try {
    const result = await reviewGarbageCollection.cleanExpired({
      root: join(params.cwd, ".lgtm"),
      excludeAppDir: params.appDir,
    });
    if (result.failures.length > 0) {
      process.stderr.write(
        `LGTM cleanup could not fully remove ${result.failures.length} expired review item(s).\n`,
      );
    }
  } catch (error) {
    process.stderr.write(
      `LGTM cleanup failed: ${error instanceof Error ? error.message : String(error)}\n`,
    );
  }
}

async function readJsonFile<T>(path: string): Promise<T> {
  return JSON.parse(await readFile(path, "utf8")) as T;
}

function sendJson(response: ServerResponse, status: number, value: unknown) {
  const body = Buffer.from(JSON.stringify(value));
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": body.length,
    "cache-control": "no-store",
  });
  response.end(body);
}

async function sendStaticFile(response: ServerResponse, webRoot: string, pathname: string) {
  const relativePath = pathname === "/" ? "index.html" : decodeURIComponent(pathname.slice(1));
  const filePath = resolve(webRoot, relativePath);
  const isOutsideWebRoot = filePath !== webRoot && !filePath.startsWith(`${webRoot}${sep}`);
  if (isOutsideWebRoot) {
    return sendJson(response, 404, { error: "Not found." });
  }

  try {
    const body = await readFile(filePath);
    response.writeHead(200, {
      "content-type": contentTypeForPath(filePath),
      "content-length": body.length,
      "cache-control":
        relativePath === "index.html" ? "no-cache" : "public, max-age=31536000, immutable",
    });
    response.end(body);
  } catch {
    sendJson(response, 404, { error: "Not found." });
  }
}

function contentTypeForPath(path: string) {
  const contentTypes: Record<string, string> = {
    ".css": "text/css; charset=utf-8",
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".map": "application/json; charset=utf-8",
    ".svg": "image/svg+xml",
    ".woff2": "font/woff2",
  };
  return contentTypes[extname(path).toLowerCase()] ?? "application/octet-stream";
}
