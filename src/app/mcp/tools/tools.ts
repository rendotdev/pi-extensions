import type { McpTool } from "../types/types.ts";

const commonProperties = {
  cwd: {
    type: "string",
    description: "Project directory. Defaults to the MCP server working directory.",
  },
  name: { type: "string", description: "Human-readable review name." },
};

const remoteProperties = {
  remote: {
    type: "string",
    description: "Optional OpenSSH destination or SSH config alias.",
  },
  remoteCwd: {
    type: "string",
    description: "Absolute repository path on the remote machine. Required with remote.",
  },
  sinceLast: {
    type: "boolean",
    description: "Review only changes since the newest compatible completed lgtm review.",
  },
};

const groupsProperty = {
  type: "array",
  minItems: 1,
  description: "Optional conceptual file groups in review order.",
  items: {
    type: "object",
    properties: {
      title: { type: "string" },
      files: { type: "array", minItems: 1, items: { type: "string" } },
    },
    required: ["title", "files"],
    additionalProperties: false,
  },
};

export const mcpTools: McpTool[] = [
  {
    name: "open_git_review",
    description:
      "Open local or SSH-hosted Git changes for human review and return its durable URL and review path immediately.",
    inputSchema: {
      type: "object",
      properties: { ...commonProperties, ...remoteProperties, groups: groupsProperty },
      required: ["name"],
      additionalProperties: false,
    },
  },
  {
    name: "open_worktree_review",
    description:
      "Open changes from a local or SSH-hosted Git worktree and return its durable URL and review path immediately.",
    inputSchema: {
      type: "object",
      properties: {
        ...commonProperties,
        remote: remoteProperties.remote,
        groups: groupsProperty,
        path: {
          type: "string",
          description: "Local worktree path, or an absolute remote worktree path with remote.",
        },
      },
      required: ["path"],
      additionalProperties: false,
    },
  },
  {
    name: "open_json_review",
    description:
      "Open explicitly supplied before-and-after file content for human review and return its durable URL and review path immediately. Each file requires location, oldContent, and newContent strings.",
    inputSchema: {
      type: "object",
      properties: {
        ...commonProperties,
        groups: groupsProperty,
        files: {
          type: "array",
          minItems: 1,
          items: {
            type: "object",
            properties: {
              location: { type: "string" },
              oldContent: { type: "string" },
              newContent: { type: "string" },
            },
            required: ["location", "oldContent", "newContent"],
            additionalProperties: false,
          },
        },
      },
      required: ["files"],
      additionalProperties: false,
    },
  },
  {
    name: "open_document_review",
    description:
      "Open Markdown for human review and return its durable URL and review path immediately.",
    inputSchema: {
      type: "object",
      properties: {
        ...commonProperties,
        markdown: { type: "string", description: "Markdown content to review." },
        location: { type: "string", description: "Optional source document location." },
      },
      required: ["markdown"],
      additionalProperties: false,
    },
  },
  {
    name: "finish_review",
    description:
      "Read the specified review result. Restart its server if the review is open but unreachable, or stop the server after a terminal decision.",
    inputSchema: {
      type: "object",
      properties: {
        cwd: commonProperties.cwd,
        reviewPath: {
          type: "string",
          description: "review.json path returned when opening the review.",
        },
      },
      required: ["reviewPath"],
      additionalProperties: false,
    },
  },
];
