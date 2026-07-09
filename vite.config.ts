import { defineConfig } from "vite-plus";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  root: "web",
  plugins: [tailwindcss()],
  build: {
    outDir: "../dist/web",
    emptyOutDir: true,
  },
  fmt: {
    ignorePatterns: ["dist/**", ".lgtm/**"],
    sortPackageJson: true,
  },
  lint: {
    ignorePatterns: ["dist/**", ".lgtm/**"],
    jsPlugins: [{ name: "vite-plus", specifier: "vite-plus/oxlint-plugin" }],
    rules: { "vite-plus/prefer-vite-plus-imports": "error" },
    options: { typeAware: true, typeCheck: true },
  },
  test: {
    include: ["src/**/*.test.ts"],
    passWithNoTests: true,
  },
  pack: {
    entry: ["src/cli.ts"],
    format: ["esm"],
    outDir: "dist",
    clean: false,
  },
  run: {
    tasks: {
      "build:web": {
        command: "vp build",
        cache: true,
        output: ["dist/web/**"],
      },
      "build:cli": {
        command: "vp pack",
        cache: true,
        output: ["dist/cli.mjs"],
      },
      package: {
        command: 'node -e "" --',
        dependsOn: ["build:web", "build:cli"],
        cache: false,
      },
    },
  },
});
