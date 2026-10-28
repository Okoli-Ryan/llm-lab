import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  server: {
    // Forward /api to Express, so the browser sees one origin (no CORS setup needed).
    proxy: { "/api": "http://localhost:3001" },
  },
});
