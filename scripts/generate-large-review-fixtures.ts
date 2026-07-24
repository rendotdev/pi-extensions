import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import process from "node:process";
import { defineApp } from "../src/define.ts";
import type { DiffReviewFileInput } from "../src/domains/review/index.ts";

export type LargeReviewFixtureManifest = {
  diff: {
    fileCount: number;
    linesPerFile: number;
    path: string;
  };
  document: {
    codeBlockCount: number;
    path: string;
    sectionCount: number;
    sourceLineCount: number;
  };
};

await defineApp({
  params: {
    codeLinesPerBlock: 32,
    diffFileCount: 64,
    diffLinesPerFile: 500,
    documentSectionCount: 280,
    outputDirectory: resolve(process.cwd(), "e2e/.generated"),
  },
  deps: { mkdir, writeFile },
  async run() {
    const entrypointParams = this.params;
    const entrypointDeps = this.deps;
    async function generate(): Promise<LargeReviewFixtureManifest> {
      await entrypointDeps.mkdir(entrypointParams.outputDirectory, { recursive: true });
      const diffPath = resolve(entrypointParams.outputDirectory, "large-diff.json");
      const documentPath = resolve(entrypointParams.outputDirectory, "large-document.md");
      const manifestPath = resolve(entrypointParams.outputDirectory, "manifest.json");
      const files = createDiffFiles();
      const markdown = createDocument();
      const manifest: LargeReviewFixtureManifest = {
        diff: {
          fileCount: files.length,
          linesPerFile: entrypointParams.diffLinesPerFile,
          path: diffPath,
        },
        document: {
          codeBlockCount: Math.floor(entrypointParams.documentSectionCount / 4),
          path: documentPath,
          sectionCount: entrypointParams.documentSectionCount,
          sourceLineCount: markdown.split("\n").length,
        },
      };
      await Promise.all([
        entrypointDeps.writeFile(
          diffPath,
          `${JSON.stringify({ name: "Extremely large diff", files })}\n`,
          "utf8",
        ),
        entrypointDeps.writeFile(documentPath, markdown, "utf8"),
        entrypointDeps.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8"),
      ]);
      process.stdout.write(
        `Generated ${manifest.diff.fileCount} diff files and ${manifest.document.sourceLineCount} document lines in ${entrypointParams.outputDirectory}\n`,
      );
      return manifest;
    }

    function createDiffFiles(): DiffReviewFileInput[] {
      return Array.from({ length: entrypointParams.diffFileCount }, (_, fileIndex) => {
        const oldLines: string[] = [];
        const newLines: string[] = [];
        for (let lineIndex = 1; lineIndex <= entrypointParams.diffLinesPerFile; lineIndex += 1) {
          const identifier = `${String(fileIndex).padStart(3, "0")}_${String(lineIndex).padStart(4, "0")}`;
          const stableLine = `export const fixture_${identifier} = createFixtureValue({ file: ${fileIndex}, line: ${lineIndex}, payload: "deterministic-large-review-${identifier}" });`;
          oldLines.push(stableLine);
          const isChangedLine = lineIndex % 11 === 0;
          newLines.push(
            isChangedLine
              ? `export const fixture_${identifier} = createFixtureValue({ file: ${fileIndex}, line: ${lineIndex}, payload: "updated-large-review-${identifier}", reviewed: true });`
              : stableLine,
          );
          if (lineIndex % 47 === 0) {
            newLines.push(
              `export const added_${identifier} = createAddedFixture({ source: "${identifier}", enabled: true });`,
            );
          }
        }
        return {
          location: `src/generated/area-${String(Math.floor(fileIndex / 8)).padStart(2, "0")}/extremely-large-file-${String(fileIndex).padStart(3, "0")}.ts`,
          oldContent: `${oldLines.join("\n")}\n`,
          newContent: `${newLines.join("\n")}\n`,
        };
      });
    }

    function createDocument(): string {
      const sections = [
        "# Extremely large document review",
        "",
        "This generated document deliberately combines long prose, tables, lists, and code blocks so the complete document review surface is exercised under sustained load.",
        "",
      ];
      for (
        let sectionIndex = 1;
        sectionIndex <= entrypointParams.documentSectionCount;
        sectionIndex += 1
      ) {
        const sectionLabel = String(sectionIndex).padStart(4, "0");
        sections.push(`## Performance section ${sectionLabel}`, "");
        for (let paragraphIndex = 1; paragraphIndex <= 4; paragraphIndex += 1) {
          sections.push(
            `Section ${sectionLabel}, paragraph ${paragraphIndex} contains deterministic review prose with enough repeated detail to produce a realistically large Markdown tree while preserving a unique text target for selection, navigation, and comment placement.`,
            "",
          );
        }
        sections.push("| Setting | Default | Purpose | Section |", "| --- | ---: | --- | ---: |");
        for (let rowIndex = 1; rowIndex <= 10; rowIndex += 1) {
          sections.push(
            `| Generated setting ${sectionLabel}-${String(rowIndex).padStart(2, "0")} | ${sectionIndex * rowIndex} ms | Validates precise table-row selection and inline comment layout under load | ${sectionIndex} |`,
          );
        }
        sections.push("", "- Rendering stays responsive while the document is large.");
        sections.push(
          "- Scrolling reaches deterministic deep targets without losing selection state.",
        );
        sections.push("- Comment drafts remain stable while other blocks update.", "");
        if (sectionIndex % 4 === 0) {
          sections.push("```ts");
          for (let codeLine = 1; codeLine <= entrypointParams.codeLinesPerBlock; codeLine += 1) {
            sections.push(
              `const section_${sectionLabel}_line_${String(codeLine).padStart(2, "0")} = runLargeDocumentOperation({ section: ${sectionIndex}, line: ${codeLine}, label: "large-document-${sectionLabel}-${String(codeLine).padStart(2, "0")}" });`,
            );
          }
          sections.push("```", "");
        }
      }
      return `${sections.join("\n")}\n`;
    }
    return await generate();
  },
});
