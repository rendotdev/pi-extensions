import type { Context, Ranged } from "@oxlint/plugins";

export function countMeaningfulLines(context: Context, range?: Ranged["range"]) {
  const [start, end] = range ?? [0, context.sourceCode.text.length];
  const text = context.sourceCode.text.slice(start, end);
  const characters = text.split("");
  for (const comment of context.sourceCode.getAllComments()) {
    const commentStart = Math.max(comment.range[0], start) - start;
    const commentEnd = Math.min(comment.range[1], end) - start;
    const isOutsideRange = commentStart >= characters.length || commentEnd <= 0;
    if (isOutsideRange) {
      continue;
    }
    for (
      let index = Math.max(commentStart, 0);
      index < Math.min(commentEnd, characters.length);
      index++
    ) {
      const isLineBreak = characters[index] === "\n" || characters[index] === "\r";
      if (!isLineBreak) {
        characters[index] = " ";
      }
    }
  }
  return characters
    .join("")
    .split(/\r?\n/u)
    .filter((line) => line.trim().length > 0).length;
}
