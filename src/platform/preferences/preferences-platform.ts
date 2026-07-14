import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { applyEdits, modify, parse, type ParseError } from "jsonc-parser";
import { DomainClass } from "../../domain/domain-class.ts";
import {
  LgtmPreferences as LgtmPreferencesDomain,
  type LgtmPreferences,
} from "../../domain/preferences/preferences.ts";

export class LgtmPreferencesPlatformClass extends DomainClass<{ cwd: string }, {}> {
  public readonly path: string;
  public constructor(params: { cwd: string }, deps: {}) {
    super(params, deps);
    this.path = join(params.cwd, ".lgtm", "lgtm.jsonc");
  }

  public async read(): Promise<LgtmPreferences> {
    const source = await this.readSource();
    if (source === undefined) {
      return { ...LgtmPreferencesDomain.defaults };
    }
    return LgtmPreferencesDomain.parse({ value: this.parseSource({ source }) });
  }

  public async write(params: { preferences: LgtmPreferences }): Promise<LgtmPreferences> {
    const preferences = LgtmPreferencesDomain.parse({ value: params.preferences });
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
    const updatedSource = applyEdits(
      lineWrapSource,
      modify(lineWrapSource, ["sidebarWidth"], preferences.sidebarWidth, {
        formattingOptions,
      }),
    );
    await mkdir(join(this.params.cwd, ".lgtm"), { recursive: true });
    const temporaryPath = `${this.path}.${process.pid}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporaryPath, updatedSource, "utf8");
      await rename(temporaryPath, this.path);
    } finally {
      await rm(temporaryPath, { force: true });
    }
    return preferences;
  }

  private async readSource() {
    try {
      return await readFile(this.path, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return undefined;
      }
      throw error;
    }
  }

  private parseSource(params: { source: string }) {
    const errors: ParseError[] = [];
    const value = parse(params.source, errors, { allowTrailingComma: true });
    if (errors.length > 0) {
      throw new Error("Unable to parse .lgtm/lgtm.jsonc.");
    }
    return value as unknown;
  }
}
