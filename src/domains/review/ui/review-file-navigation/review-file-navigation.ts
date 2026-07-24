import { defineService } from "../../../../define.ts";

export class ReviewFileNavigation extends defineService({
  params: { parameterName: "file" },
  deps: {},
}) {
  public read(params: { search: string }): string | null {
    const value = new URLSearchParams(params.search).get(this.params.parameterName);
    return value?.trim() ? value : null;
  }

  public createHref(params: { href: string; fileLocation: string }): string {
    const url = new URL(params.href);
    url.searchParams.set(this.params.parameterName, params.fileLocation);
    return `${url.pathname}${url.search}${url.hash}`;
  }
}
