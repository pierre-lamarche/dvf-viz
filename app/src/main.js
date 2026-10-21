import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { TILE_URL } from "./config.js";
import { initDuckDB, queryTx, _db } from "./duckdb.js";

const statusEl = document.getElementById("status");
const panelEl = document.getElementById("panel");
const panelTitle = document.getElementById("panel-title");
const panelMeta = document.getElementById("panel-meta");
const panelTx = document.getElementById("panel-tx");

const CARTO = [
  "https://a.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png",
  "https://b.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png",
  "https://c.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png",
];

const map = new maplibregl.Map({
  container: "map",
  style: {
    version: 8,
    sources: {
      carto: { type: "raster", tiles: CARTO, tileSize: 256, maxzoom: 19 },
      parcels: { type: "vector", tiles: [TILE_URL], minzoom: 0, maxzoom: 14 },
    },
    layers: [
      { id: "bg", type: "background", paint: { "background-color": "#f8f8f8" } },
      { id: "carto", type: "raster", source: "carto", paint: { "raster-opacity": 1 } },
      {
        id: "parcels-fill",
        type: "fill",
        source: "parcels",
        "source-layer": "parcels",
        paint: { "fill-color": "#8b8b8b", "fill-opacity": 0.55 },
      },
      {
        id: "parcels-line",
        type: "line",
        source: "parcels",
        "source-layer": "parcels",
        paint: { "line-color": "#6a6a6a", "line-width": 0.6 },
      },
      {
        id: "parcels-selected",
        type: "fill",
        source: "parcels",
        "source-layer": "parcels",
        filter: ["==", ["get", "idpar"], ""],
        paint: { "fill-color": "#d1495b", "fill-opacity": 0.9 },
      },
    ],
  },
  center: [2.21, 46.6],
  zoom: 5.4,
  minZoom: 2,
  maxZoom: 17,
  attributionControl: { compact: true },
});

map.addControl(new maplibregl.NavigationControl(), "top-right");

// Debug / console handle (useful for inspecting in DevTools).
window.__map = map;
window.__duck = _db;
window.__queryTx = queryTx;

map.on("error", (e) => {
  if (e.error && /tile|parcels|Failed to fetch/i.test(e.error.message || "")) return; // tile 404s
  console.error("map error:", e.error);
});

map.on("load", async () => {
  statusEl.textContent = "chargement de DuckDB…";
  await initDuckDB();
  statusEl.textContent = "prêt — cliquez sur une parcelle";

  map.on("click", "parcels-fill", onParcelClick);
  map.on("mouseenter", "parcels-fill", () => (map.getCanvas().style.cursor = "pointer"));
  map.on("mouseleave", "parcels-fill", () => (map.getCanvas().style.cursor = ""));
  map.on("click", (e) => {
    const over = map.queryRenderedFeatures(e.point, { layers: ["parcels-fill"] });
    if (!over.length) clearSelection();
  });

  document.getElementById("panel-close").addEventListener("click", clearSelection);
});

let busy = false;

async function onParcelClick(e) {
  const f = e.features && e.features[0];
  if (!f || busy) return;
  const { idpar, coddep, prix } = f.properties;
  map.setFilter("parcels-selected", ["==", ["get", "idpar"], idpar]);
  panelTitle.textContent = `Parcelle ${idpar}`;
  panelMeta.innerHTML = metaHtml({ coddep, prix });
  panelTx.innerHTML = '<p class="muted">Chargement des mutations…</p>';
  panelEl.classList.remove("hidden");

  busy = true;
  try {
    const rows = await queryTx(coddep, idpar);
    panelTx.innerHTML = rows.length ? txTable(rows) : '<p class="muted">Aucune mutation trouvée.</p>';
  } catch (err) {
    panelTx.innerHTML = `<p class="err">Erreur : ${escapeHtml(err.message)}</p>`;
  } finally {
    busy = false;
  }
}

function clearSelection() {
  map.setFilter("parcels-selected", ["==", ["get", "idpar"], ""]);
  panelEl.classList.add("hidden");
}

function metaHtml({ coddep, prix }) {
  let h = `<div>Department : <b>${escapeHtml(String(coddep))}</b></div>`;
  if (prix != null) h += `<div>Prix (dernier) : <b>${fmt(prix)} €</b></div>`;
  return h;
}

function txTable(rows) {
  let h =
    '<table><thead><tr><th>Date</th><th>Prix</th><th>Type</th><th>Surface</th></tr></thead><tbody>';
  for (const r of rows) {
    let d = r.datemut;
    if (typeof d === "number") d = new Date(d).toISOString().slice(0, 10);
    else if (d instanceof Date) d = d.toISOString().slice(0, 10);
    h += `<tr><td>${escapeHtml(String(d))}</td>`;
    h += `<td>${r.prix != null ? fmt(r.prix) + " €" : "—"}</td>`;
    h += `<td>${escapeHtml(String(r.type ?? "—"))}</td>`;
    h += `<td>${r.surface != null ? fmt(r.surface) + " m²" : "—"}</td></tr>`;
  }
  return h + "</tbody></table>";
}

function fmt(n) {
  return Number(n).toLocaleString("fr-FR", { maximumFractionDigits: 0 });
}
function escapeHtml(s) {
  return s.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]),
  );
}
