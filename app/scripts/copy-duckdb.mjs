// Vendors the DuckDB-WASM assets (worker + wasm) from node_modules into
// public/duckdb so Vite copies them into dist/. Run automatically before
// `dev` and `build` (see package.json predev / prebuild).
import { mkdirSync, copyFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url)); // app/scripts
const app = dirname(here); // app
const src = join(app, "node_modules/@duckdb/duckdb-wasm/dist");
const dst = join(app, "public/duckdb");

mkdirSync(dst, { recursive: true });
for (const f of ["duckdb-browser-mvp.worker.js", "duckdb-mvp.wasm"]) {
  copyFileSync(join(src, f), join(dst, f));
}
console.log("[copy-duckdb] vendored DuckDB-WASM -> app/public/duckdb");
