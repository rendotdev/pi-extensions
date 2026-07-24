import { defineConfig } from "../../../define.ts";

export const REVIEW_RETENTION_MILLISECONDS = defineConfig(7 * 24 * 60 * 60 * 1_000);
