import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import process from "node:process";
import { applyEdits, modify, parse, type ParseError } from "jsonc-parser";
import { defineRepo } from "../../../../define.ts";
import { defaultPreferences } from "../../config/preferences-config/preferences-config.ts";
import { parseLgtmPreferences, type LgtmPreferences } from "../../types/preferences/preferences.ts";

export class PreferencesStore extends defineRepo({
  params: { cwd: process.cwd() },
  deps: {},
}) {
  public getPath(params: {}): string {
    void params;
    return join(this.params.cwd, ".lgtm", "lgtm.jsonc");
  }

  public async read(params: {}): Promise<LgtmPreferences> {
    void params;
    const source = await this.readSource();
    if (source === undefined) {
      return { ...defaultPreferences };
    }
    return parseLgtmPreferences({
      value: this.parseSource({ source }),
      defaults: defaultPreferences,
    });
  }

  public async write(params: { preferences: LgtmPreferences }): Promise<LgtmPreferences> {
    const preferences = parseLgtmPreferences({
      value: params.preferences,
      defaults: defaultPreferences,
    });
    const source = (await this.readSource()) ?? "{}\n";
    this.parseSource({ source });
    const formattingOptions = { insertSpaces: true, tabSize: 2, eol: "\n" };
    const diffStyleSource = applyEdits(
      source,
      modify(source, ["diffStyle"], preferences.diffStyle, { formattingOptions }),
    );
    const lineWrapSource = applyEdits(
      diffStyleSource,
      modify(diffStyleSource, ["lineWrap"], preferences.lineWrap, { formattingOptions }),
    );
    const sidebarWidthSource = applyEdits(
      lineWrapSource,
      modify(lineWrapSource, ["sidebarWidth"], preferences.sidebarWidth, {
        formattingOptions,
      }),
    );
    const fileExpansionSource = applyEdits(
      sidebarWidthSource,
      modify(sidebarWidthSource, ["fileExpansion"], preferences.fileExpansion, {
        formattingOptions,
      }),
    );
    const updatedSource = applyEdits(
      fileExpansionSource,
      modify(fileExpansionSource, ["fileExpansionOverrides"], preferences.fileExpansionOverrides, {
        formattingOptions,
      }),
    );
    await mkdir(join(this.params.cwd, ".lgtm"), { recursive: true });
    const temporaryPath = `${this.getPath({})}.${process.pid}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporaryPath, updatedSource, "utf8");
      await rename(temporaryPath, this.getPath({}));
    } finally {
      await rm(temporaryPath, { force: true });
    }
    return preferences;
  }

  private async readSource(): Promise<string | undefined> {
    try {
      return await readFile(this.getPath({}), "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return undefined;
      }
      throw error;
    }
  }

  private parseSource(params: { source: string }): unknown {
    const errors: ParseError[] = [];
    const value = parse(params.source, errors, { allowTrailingComma: true });
    if (errors.length > 0) {
      throw new Error("Unable to parse .lgtm/lgtm.jsonc.");
    }
    return value as unknown;
  }
}
