import { defineConfig } from "../../../../define.ts";
import type { LgtmPreferences } from "../../types/preferences/preferences.ts";

export const defaultPreferences = defineConfig({
  diffStyle: "unified",
  lineWrap: false,
  sidebarWidth: 256,
  fileExpansion: "auto",
  fileExpansionOverrides: {},
} as const satisfies LgtmPreferences);
