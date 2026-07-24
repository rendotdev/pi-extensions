export const ReviewWindowTitle = {
  format(params: { cwd: string; name: string }): string {
    const pathSegments = params.cwd.split(/[\\/]/).filter(Boolean);
    return `${pathSegments.at(-1) ?? params.cwd} / ${params.name}`;
  },
};
