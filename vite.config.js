import { defineConfig } from "vite";

// GitHub Pages 把站点放在 /chuhe-hanjie/ 子路径下；本地开发仍用根路径
export default defineConfig(({ command, isPreview }) => ({
  base: command === "build" || isPreview ? process.env.BASE_PATH || "/chuhe-hanjie/" : "/",
  build: { chunkSizeWarningLimit: 900 },
}));
