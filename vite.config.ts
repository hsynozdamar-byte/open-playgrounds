import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
// @ts-expect-error plain ESM module
import { handle } from "./server/store.mjs";

export default defineConfig({
  plugins: [
    react(),
    {
      // The same API as server/app.mjs, mounted on the dev server.
      name: "playground-api",
      configureServer(server) {
        server.middlewares.use(handle);
      },
    },
  ],
  // The data file changes all the time; the app follows it through /api/events, not through a reload.
  server: { watch: { ignored: ["**/data/**"] } },
});
