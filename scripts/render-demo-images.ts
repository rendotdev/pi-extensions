import { resolve } from "node:path";
import process from "node:process";
import { defineApp } from "../src/define.ts";
import { DemoReview, type DemoReviewKind } from "../src/domains/review/index.ts";
import { DemoImage } from "../src/domains/review/runtime/index.ts";

const demoImage = new DemoImage();

await defineApp({
  params: { outputDirectory: resolve(process.cwd(), "assets") },
  deps: { render: demoImage.render.bind(demoImage) },
  async run(): Promise<void> {
    const kinds: DemoReviewKind[] = ["diff", "document"];
    const themes = ["light", "dark"] as const;
    for (const theme of themes) {
      for (const kind of kinds) {
        const suffix = theme === "dark" ? "-dark" : "";
        const output = resolve(this.params.outputDirectory, `lgtm-demo-${kind}${suffix}.jpg`);
        await this.deps.render({
          comments: DemoReview.createComments({ kind }),
          input: DemoReview.create({ kind }),
          output,
          theme,
        });
        process.stdout.write(`Rendered ${theme} ${kind} demo: ${output}\n`);
      }
    }
  },
});
