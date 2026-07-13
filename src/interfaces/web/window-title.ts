export class ReviewWindowTitleClass {
  public format(params: { cwd: string; name: string }): string {
    const pathSegments = params.cwd.split(/[\\/]/).filter(Boolean);
    return `${pathSegments.at(-1) ?? params.cwd} / ${params.name}`;
  }
}

export const ReviewWindowTitle = new ReviewWindowTitleClass();
