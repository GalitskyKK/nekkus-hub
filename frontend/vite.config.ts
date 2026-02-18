import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// https://vitejs.dev/config/
// Сборка в ui/frontend/dist для embed в Hub (go:embed).
export default defineConfig({
  plugins: [react()],
  build: {
    outDir: "../ui/frontend/dist",
    emptyOutDir: true,
  },
});
