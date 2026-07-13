import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { applyEdits, modify, parse, type ParseError } from "jsonc-parser";
import { DomainClass } from "../../domain/domain-class.ts";
import { lgtmPreferences, type LgtmPreferences } from "../../domain/preferences/preferences.ts";

export class LgtmPreferencesPlatformClass extends DomainClass<{ cwd: string }, {}> {
  public readonly path: string;
  public constructor(params: { cwd: string }, deps: {}) {
    super(params, deps);
    this.path = join(params.cwd, ".lgtm", "lgtm.jsonc");
  }

  public async read(): Promise<LgtmPreferences> {
    const source = await this.readSource();
    if (source === undefined) return { ...lgtmPreferences.defaults };
    return lgtmPreferences.parse({ value: this.parseSource({ source }) });
  }

  public async write(params: { preferences: LgtmPreferences }): Promise<LgtmPreferences> {
    const preferences = lgtmPreferences.parse({ value: params.preferences });
    const source = (await this.readSource()) ?? "{}\n";
    this.parseSource({ source });
    const edits = modify(source, ["diffStyle"], preferences.diffStyle, {
      formattingOptions: { insertSpaces: true, tabSize: 2, eol: "\n" },
    });
    await mkdir(join(this.params.cwd, ".lgtm"), { recursive: true });
    await writeFile(this.path, applyEdits(source, edits), "utf8");
    return preferences;
  }

  private async readSource() {
    try {
      return await readFile(this.path, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
      throw error;
    }
  }

  private parseSource(params: { source: string }) {
    const errors: ParseError[] = [];
    const value = parse(params.source, errors, { allowTrailingComma: true });
    if (errors.length > 0) throw new Error("Unable to parse .lgtm/lgtm.jsonc.");
    return value as unknown;
  }
}
