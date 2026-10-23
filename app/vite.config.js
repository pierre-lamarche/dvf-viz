import { defineConfig } from "vite";
import { coveragePlugin } from "./coverage-plugin.js";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(__dirname, "../out");

// Dev-only: serve /tiles/... and /tx/... from the local build output (../out).
// In production these are served from MinIO (DATA_BASE), so no data is bundled.
function serveLocalData() {
  return {
    name: "serve-local-data",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const m = req.url && req.url.match(/^\/(tiles|tx)\/(.+)$/);
        if (!m) return next();
        const base = path.join(OUT, m[1]);
        const file = path.normalize(path.join(base, decodeURIComponent(m[2])));
        if (!file.startsWith(base + path.sep)) return next();
        fs.readFile(file, (err, buf) => {
          if (err) return next();
          res.setHeader("Access-Control-Allow-Origin", "*");
          res.setHeader(
            "Content-Type",
            m[2].endsWith(".mvt") ? "application/x-protobuf" : "application/octet-stream",
          );
          res.end(buf);
        });
      });
    },
  };
}

export default defineConfig({
  base: "./",
  plugins: [coveragePlugin(), serveLocalData()],
  server: { port: 5173, host: true },
  build: { outDir: "dist", assetsInlineLimit: 0 },
});
