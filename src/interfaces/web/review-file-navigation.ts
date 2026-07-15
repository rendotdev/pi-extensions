import { DomainClass } from "../../domain/domain-class.ts";

export class ReviewFileNavigationClass extends DomainClass<{ parameterName: string }, {}> {
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

export const ReviewFileNavigation = new ReviewFileNavigationClass({ parameterName: "file" }, {});
