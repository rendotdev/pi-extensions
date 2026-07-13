export class ReviewWindowTitleClass {
  public format(params: { cwd: string }): string {
    const pathSegments = params.cwd.split(/[\\/]/).filter(Boolean);
    return `lgtm ⋅ ${pathSegments.at(-1) ?? params.cwd}`;
  }
}

export const ReviewWindowTitle = new ReviewWindowTitleClass();
