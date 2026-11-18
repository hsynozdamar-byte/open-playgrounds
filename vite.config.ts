import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
// @ts-expect-error plain ESM module
import { handle } from "./server/store.mjs";

export default defineConfig({
  plugins: [
    react(),
    {
      name: "playground-api",
      configureServer(server) {
        server.middlewares.use(handle);
      },
    },
  ],
  server: { watch: { ignored: ["**/data/**", "**/render/**"] } },
  // fluid.html: Soft Fluid görsel sistemi değerlendirme ekranı (uygulamadan ayrı sayfa)
  build: { rollupOptions: { input: { main: "index.html", fluid: "fluid.html" } } },
});
