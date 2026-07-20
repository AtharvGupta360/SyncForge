import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

/**
 * Vite config. The React plugin gives JSX + fast refresh; nothing else is
 * needed because the workspace libraries (@syncforge/client, /shared) are
 * plain ESM that Vite resolves through their package `exports`.
 */
export default defineConfig({
  plugins: [react()],
  server: { port: 5173 },
});
