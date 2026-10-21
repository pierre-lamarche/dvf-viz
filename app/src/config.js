// Where the data (MVT tiles + tx parquet shards) lives.
//   - dev:  ''  -> resolved to the page origin (served by Vite from ../out)
//   - prod: the MinIO base, e.g. 'https://minio.lab.sspcloud.fr/pierrelamarche/dvf/dvfplus/app'
// Set it at build time via VITE_DATA_BASE, or edit the default below.
//
// NOTE: MapLibre fetches vector tiles via `new Request(url)`, which requires an
// ABSOLUTE url, so we resolve to a full origin when no base is provided.
const DATA_BASE = (import.meta.env.VITE_DATA_BASE ?? "").replace(/\/$/, "");
const origin = typeof window !== "undefined" ? window.location.origin : "";
const BASE = DATA_BASE || origin;

export const TILE_URL = `${BASE}/tiles/{z}/{x}/{y}.mvt`;
export const TX_URL = (dept) => `${BASE}/tx/dept-${dept}.parquet`;

// The DuckDB-WASM bundle is part of the app itself (served from /duckdb).
export const DUCKDB_BASE = "duckdb";
