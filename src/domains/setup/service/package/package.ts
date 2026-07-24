import { defineService } from "../../../../define.ts";
import { PackageRoot, PackageVersion } from "../../repo/package/package.ts";

export class PackageService extends defineService({
  params: {},
  deps: {
    packageRoot: new PackageRoot(),
    packageVersion: new PackageVersion(),
  },
}) {
  public findRoot(params: { moduleUrl: string }): string {
    return this.deps.packageRoot.find(params);
  }

  public readVersion(params: { packageRoot: string }): string {
    return this.deps.packageVersion.read(params);
  }
}
