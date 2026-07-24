import type { finishReview, GitReview, openReview } from "../../../domains/review/index.ts";

export type JsonObject = Record<string, unknown>;
export type JsonRpcId = string | number | null;

export type JsonRpcRequest = {
  jsonrpc: "2.0";
  id?: JsonRpcId;
  method: string;
  params?: JsonObject;
};

export type McpTool = {
  name: string;
  description: string;
  inputSchema: JsonObject;
};

export type McpRuntimeDependencies = {
  collectGitReview: GitReview["collect"];
  finishReview: typeof finishReview;
  openReview: typeof openReview;
};
