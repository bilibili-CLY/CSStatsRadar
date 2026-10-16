import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  build: { outDir: "dist", emptyOutDir: true },
  // Dev 服务器固定 5173：后端 CSRF 白名单只放行该 loopback 源，端口漂移会导致 403。
  server: { port: 5173, strictPort: true },
});
