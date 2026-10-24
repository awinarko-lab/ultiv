import { defineConfig } from "vite-plus";

export default defineConfig({
  fmt: {
    ignorePatterns: ["apps/web/src/routeTree.gen.ts"],
  },
});
