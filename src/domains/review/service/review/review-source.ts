import type { DiffReviewFileInput, ReviewSourceFile } from "../../types/review.ts";

export function buildReviewSource(params: {
  file: DiffReviewFileInput;
  index: number;
}): ReviewSourceFile {
  const counts = countChangedLines({
    oldText: params.file.oldContent,
    newText: params.file.newContent,
  });
  return {
    id: `file-${params.index}`,
    location: params.file.location,
    language: languageFromPath(params.file.location),
    oldContent: params.file.oldContent,
    newContent: params.file.newContent,
    added: counts.added,
    removed: counts.removed,
  };
}

function countChangedLines(params: { oldText: string; newText: string }) {
  const oldLines = splitLines(params.oldText);
  const newLines = splitLines(params.newText);
  const cellCount = (oldLines.length + 1) * (newLines.length + 1);
  if (cellCount > 2_000_000) {
    return { added: newLines.length, removed: oldLines.length };
  }
  const width = newLines.length + 1;
  const matrix = buildLongestCommonSubsequence({ oldLines, newLines, width, cellCount });
  return countMatrixChanges({ oldLines, newLines, width, matrix });
}

function buildLongestCommonSubsequence(params: {
  oldLines: string[];
  newLines: string[];
  width: number;
  cellCount: number;
}) {
  const matrix = new Uint32Array(params.cellCount);
  for (let oldIndex = params.oldLines.length - 1; oldIndex >= 0; oldIndex -= 1) {
    for (let newIndex = params.newLines.length - 1; newIndex >= 0; newIndex -= 1) {
      matrix[oldIndex * params.width + newIndex] =
        params.oldLines[oldIndex] === params.newLines[newIndex]
          ? matrix[(oldIndex + 1) * params.width + newIndex + 1] + 1
          : Math.max(
              matrix[(oldIndex + 1) * params.width + newIndex],
              matrix[oldIndex * params.width + newIndex + 1],
            );
    }
  }
  return matrix;
}

function countMatrixChanges(params: {
  oldLines: string[];
  newLines: string[];
  width: number;
  matrix: Uint32Array;
}) {
  let oldIndex = 0;
  let newIndex = 0;
  let added = 0;
  let removed = 0;
  while (oldIndex < params.oldLines.length && newIndex < params.newLines.length) {
    if (params.oldLines[oldIndex] === params.newLines[newIndex]) {
      oldIndex += 1;
      newIndex += 1;
    } else if (
      params.matrix[(oldIndex + 1) * params.width + newIndex] >=
      params.matrix[oldIndex * params.width + newIndex + 1]
    ) {
      removed += 1;
      oldIndex += 1;
    } else {
      added += 1;
      newIndex += 1;
    }
  }
  return {
    removed: removed + params.oldLines.length - oldIndex,
    added: added + params.newLines.length - newIndex,
  };
}

function splitLines(value: string) {
  return value.length === 0 ? [] : value.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
}

function languageFromPath(location: string) {
  const suffixIndex = location.lastIndexOf(".");
  const extension = suffixIndex < 0 ? "" : location.slice(suffixIndex).toLowerCase();
  const languages: Record<string, string> = {
    ".astro": "astro",
    ".bash": "bash",
    ".c": "c",
    ".cpp": "cpp",
    ".cs": "csharp",
    ".css": "css",
    ".diff": "diff",
    ".go": "go",
    ".graphql": "graphql",
    ".h": "c",
    ".html": "html",
    ".java": "java",
    ".js": "javascript",
    ".json": "json",
    ".jsx": "jsx",
    ".kt": "kotlin",
    ".lua": "lua",
    ".md": "markdown",
    ".mdx": "mdx",
    ".php": "php",
    ".py": "python",
    ".rb": "ruby",
    ".rs": "rust",
    ".scss": "scss",
    ".sh": "bash",
    ".svelte": "svelte",
    ".toml": "toml",
    ".ts": "typescript",
    ".tsx": "tsx",
    ".vue": "vue",
    ".xml": "xml",
    ".yaml": "yaml",
    ".yml": "yaml",
    ".zsh": "bash",
  };
  return languages[extension] ?? "text";
}
