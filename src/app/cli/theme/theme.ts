export const TerminalColors = {
  loading: "cyan",
  success: "green",
  error: "red",
  muted: "gray",
  foreground: "white",
} as const;

const loadingFrames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"] as const;

export const TerminalIcons = {
  success: "✔",
  error: "✖",
  loading(params: { frame: number }): string {
    return loadingFrames[params.frame % loadingFrames.length];
  },
} as const;
