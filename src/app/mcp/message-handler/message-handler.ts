import { createMcpToolHandler } from "../tool-handler/tool-handler.ts";
import { mcpTools } from "../tools/tools.ts";
import type { JsonObject, JsonRpcId, JsonRpcRequest } from "../types/types.ts";

const MCP_PROTOCOL_VERSION = "2025-06-18";

export function createMcpMessageHandler(
  send: (value: unknown) => void,
  callTool = createMcpToolHandler(),
) {
  const calls = new Map<JsonRpcId, AbortController>();
  function respond(id: JsonRpcId, result: unknown) {
    return send({ jsonrpc: "2.0", id, result });
  }
  function respondError(id: JsonRpcId, code: number, message: string) {
    return send({ jsonrpc: "2.0", id, error: { code, message } });
  }

  function handleLine(line: string) {
    if (!line.trim()) {
      return;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(line) as unknown;
    } catch {
      respondError(null, -32700, "Parse error");
      return;
    }
    if (!isJsonRpcRequest(parsed)) {
      respondError(null, -32600, "Invalid Request");
      return;
    }
    handleRequest(parsed);
  }

  function handleRequest(request: JsonRpcRequest) {
    if (request.method === "notifications/initialized") {
      return;
    }
    const isCancellation =
      request.method === "notifications/cancelled" || request.method === "$/cancelRequest";
    if (isCancellation) {
      cancelRequest(calls, request);
      return;
    }
    if (request.id === undefined) {
      return;
    }
    if (request.method === "initialize") {
      respond(request.id, {
        protocolVersion: MCP_PROTOCOL_VERSION,
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: "lgtm", version: "0.1.0" },
      });
      return;
    }
    if (request.method === "ping") {
      respond(request.id, {});
      return;
    }
    if (request.method === "tools/list") {
      respond(request.id, { tools: mcpTools });
      return;
    }
    if (request.method !== "tools/call") {
      respondError(request.id, -32601, `Method not found: ${request.method}`);
      return;
    }
    startToolCall(calls, request.id, request.params, callTool, respond, respondError);
  }

  function close() {
    for (const controller of calls.values()) {
      controller.abort(new DOMException("MCP transport closed.", "AbortError"));
    }
  }

  return { close, handleLine };
}

function cancelRequest(calls: Map<JsonRpcId, AbortController>, request: JsonRpcRequest): void {
  const id = request.params?.requestId as JsonRpcId | undefined;
  if (id !== undefined) {
    calls.get(id)?.abort(new DOMException("Tool call canceled.", "AbortError"));
  }
}

function startToolCall(
  calls: Map<JsonRpcId, AbortController>,
  id: JsonRpcId,
  params: JsonObject | undefined,
  callTool: ReturnType<typeof createMcpToolHandler>,
  respond: (id: JsonRpcId, result: unknown) => void,
  respondError: (id: JsonRpcId, code: number, message: string) => void,
): void {
  const toolName = params?.name;
  if (typeof toolName !== "string") {
    respondError(id, -32602, "tools/call requires a string name.");
    return;
  }
  const controller = new AbortController();
  calls.set(id, controller);
  void callTool(toolName, params?.arguments, controller.signal)
    .then((value) => respond(id, toolResult(value)))
    .catch((error) => respond(id, toolError(error)))
    .finally(() => calls.delete(id));
}

function toolResult(value: unknown) {
  return {
    content: [{ type: "text", text: JSON.stringify(value, null, 2) }],
    structuredContent: value,
  };
}

function toolError(error: unknown) {
  return {
    content: [{ type: "text", text: error instanceof Error ? error.message : String(error) }],
    isError: true,
  };
}

function isJsonRpcRequest(value: unknown): value is JsonRpcRequest {
  const isInvalidValue = !value || typeof value !== "object" || Array.isArray(value);
  if (isInvalidValue) {
    return false;
  }
  const request = value as JsonObject;
  const isInvalidEnvelope = request.jsonrpc !== "2.0" || typeof request.method !== "string";
  if (isInvalidEnvelope) {
    return false;
  }
  const isInvalidId =
    request.id !== undefined &&
    request.id !== null &&
    typeof request.id !== "string" &&
    typeof request.id !== "number";
  if (isInvalidId) {
    return false;
  }
  return request.params === undefined || isJsonObject(request.params);
}

function isJsonObject(value: unknown): value is JsonObject {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
