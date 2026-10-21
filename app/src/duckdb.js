import * as duckdb from "@duckdb/duckdb-wasm";
import { DUCKDB_BASE, TX_URL } from "./config.js";

let db, conn;
const loadedDepts = new Set();

// Absolute URLs (served from /duckdb, part of the app bundle).
const abs = (p) => new URL(p, document.baseURI).href;

export async function initDuckDB() {
  const bundle = await duckdb.selectBundle({
    mvp: {
      mainModule: abs(`${DUCKDB_BASE}/duckdb-mvp.wasm`),
      mainWorker: abs(`${DUCKDB_BASE}/duckdb-browser-mvp.worker.js`),
    },
  });
  const worker = new Worker(bundle.mainWorker);
  db = new duckdb.AsyncDuckDB(new duckdb.ConsoleLogger(), worker);
  await db.instantiate(bundle.mainModule, bundle.pthreadWorker);
  conn = await db.connect();
}

// Fetch a department's tx shard once, load it into an in-memory table `tx`.
async function ensureDept(coddep) {
  if (loadedDepts.has(coddep)) return;
  const resp = await fetch(TX_URL(coddep));
  if (!resp.ok) throw new Error(`shard ${coddep}: HTTP ${resp.status}`);
  const buf = new Uint8Array(await resp.arrayBuffer());
  const name = `/mem/tx-${coddep}.parquet`;
  await db.registerFileBuffer(name, buf);
  await conn.query(
    `CREATE OR REPLACE TABLE tx AS SELECT * FROM read_parquet('${name}')`,
  );
  await db.dropFile(name);
  loadedDepts.add(coddep);
}

// Debug handle for DevTools / automated tests.
export function _db() {
  return { db, conn };
}

// Return all transactions for one parcel, as an array of plain objects.
// NOTE: this DuckDB-WASM dev build's prepared-statement param binding is broken
// ("Invalid column type for argument 0"), so we inline the id (validated to
// alphanumeric — cadastre ids are digits + uppercase letters — so it's safe).
export async function queryTx(coddep, idpar) {
  await ensureDept(coddep);
  if (!/^[0-9A-Za-z]+$/.test(String(idpar))) throw new Error("parcel id invalide");
  const table = await conn.query(
    `SELECT strftime(datemut, '%Y-%m-%d') AS datemut, annee, prix, type, surface ` +
      `FROM tx WHERE idpar = '${idpar}' ORDER BY datemut`,
  );
  const cols = ["datemut", "annee", "prix", "type", "surface"];
  const rows = [];
  for (let i = 0; i < table.numRows; i++) {
    const r = {};
    for (const c of cols) {
      let v = table.getChild(c).get(i);
      if (typeof v === "bigint") v = Number(v);
      r[c] = v;
    }
    rows.push(r);
  }
  return rows;
}
