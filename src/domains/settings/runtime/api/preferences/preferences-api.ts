import type { IncomingMessage, ServerResponse } from "node:http";
import { LgtmPreferences } from "../../../service/preferences/preferences.ts";
import type { LgtmPreferences as LgtmPreferencesType } from "../../../types/preferences/preferences.ts";

export type PreferencesApiRouteRequest = {
  request: IncomingMessage;
  response: ServerResponse;
  url: URL;
};

export function matchesPreferencesRequest(params: {
  request: IncomingMessage;
  url: URL;
  method: string;
}): boolean {
  return params.request.method === params.method && params.url.pathname === "/api/preferences";
}

export async function readPreferencesRequest(params: {
  request: IncomingMessage;
}): Promise<LgtmPreferencesType> {
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
  return LgtmPreferences.parse({ value: JSON.parse(Buffer.concat(chunks).toString("utf8")) });
}

export function sendPreferencesResponse(params: {
  response: ServerResponse;
  status: number;
  preferences: LgtmPreferencesType;
}): void {
  const body = Buffer.from(JSON.stringify(LgtmPreferences.parse({ value: params.preferences })));
  params.response.writeHead(params.status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": body.length,
    "cache-control": "no-store",
  });
  params.response.end(body);
}
