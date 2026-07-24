import { readFile, writeFile } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import { defineRuntime } from "../../../../../define.ts";

export type ApiSchema<Output> = {
  parse: (value: unknown) => Output;
};

export type ApiRouteRequest = {
  request: IncomingMessage;
  response: ServerResponse;
  url: URL;
};

export type ApiRoute = {
  handle: (params: ApiRouteRequest) => Promise<boolean>;
};

export class ApiRouteRuntime extends defineRuntime({
  params: {},
  deps: {},
}) {
  public matches(params: ApiRouteRequest & { method: string; path: string }): boolean {
    return params.request.method === params.method && params.url.pathname === params.path;
  }
  public async readJsonFile<Output>(params: {
    path: string;
    schema: ApiSchema<Output>;
  }): Promise<Output> {
    return params.schema.parse(JSON.parse(await readFile(params.path, "utf8")));
  }
  public async readRequest<Output>(params: {
    request: IncomingMessage;
    schema: ApiSchema<Output>;
  }): Promise<Output> {
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of params.request) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      size += buffer.length;
      if (size > 10 * 1024 * 1024) {
        throw new Error("Request body is too large.");
      }
      chunks.push(buffer);
    }
    return params.schema.parse(JSON.parse(Buffer.concat(chunks).toString("utf8")));
  }
  public async writeJsonFile<Output>(params: {
    path: string;
    schema: ApiSchema<Output>;
    value: unknown;
  }): Promise<Output> {
    const value = params.schema.parse(params.value);
    await writeFile(params.path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
    return value;
  }
  public send<Output>(params: {
    response: ServerResponse;
    status: number;
    schema: ApiSchema<Output>;
    value: unknown;
  }): void {
    const body = Buffer.from(JSON.stringify(params.schema.parse(params.value)));
    params.response.writeHead(params.status, {
      "content-type": "application/json; charset=utf-8",
      "content-length": body.length,
      "cache-control": "no-store",
    });
    params.response.end(body);
  }
}

export const ApiRoute = new ApiRouteRuntime();
