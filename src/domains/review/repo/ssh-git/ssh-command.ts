import { defineRepo } from "../../../../define.ts";

export class SSHCommand extends defineRepo({
  params: { maximumCommandLength: 65_536 },
  deps: {},
}) {
  public quote(params: { value: string }): string {
    if (params.value.includes("\0")) {
      throw new Error("SSH command arguments cannot contain NUL bytes.");
    }
    return `'${params.value.replaceAll("'", `'"'"'`)}'`;
  }

  public executable(params: { marker: string; executable: string; args: string[] }): string {
    const command = [params.executable, ...params.args]
      .map((value) => this.quote({ value }))
      .join(" ");
    return this.validate({
      command: `printf '%s\\n' ${this.quote({ value: params.marker })}; exec ${command}`,
    });
  }

  public hasHead(params: { marker: string; root: string }): string {
    const root = this.quote({ value: params.root });
    const marker = this.quote({ value: params.marker });
    return this.validate({
      command: `if git -C ${root} rev-parse --verify HEAD >/dev/null 2>&1; then printf '%s\\ntrue' ${marker}; else printf '%s\\nfalse' ${marker}; fi`,
    });
  }

  public worktreeFile(params: { marker: string; path: string }): string {
    const path = this.quote({ value: params.path });
    const marker = this.quote({ value: params.marker });
    return this.validate({
      command: `printf '%s\\n' ${marker}; if [ -L ${path} ]; then readlink ${path}; else cat ${path}; fi`,
    });
  }

  private validate(params: { command: string }): string {
    if (Buffer.byteLength(params.command) > this.params.maximumCommandLength) {
      throw new Error(
        `SSH command exceeds the ${this.params.maximumCommandLength}-byte safety limit.`,
      );
    }
    return params.command;
  }
}
