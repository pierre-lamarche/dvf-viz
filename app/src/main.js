import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { TILE_URL } from "./config.js";
import { initDuckDB, queryTx, _db } from "./duckdb.js";

const statusEl = document.getElementById("status");
const panelEl = document.getElementById("panel");
const panelTitle = document.getElementById("panel-title");
const panelMeta = document.getElementById("panel-meta");
const panelTx = document.getElementById("panel-tx");

// CARTO basemaps require an API key (free, no account: https://carto.com/basemaps/apikey/).
// Supplied at build time via VITE_CARTO_KEY (a GitHub Actions secret in CI).
const CARTO_KEY = import.meta.env.VITE_CARTO_KEY || "";
const CARTO_QS = CARTO_KEY ? `?key=${CARTO_KEY}` : "";
const CARTO = [
  `https://a.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png${CARTO_QS}`,
  `https://b.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png${CARTO_QS}`,
  `https://c.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png${CARTO_QS}`,
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
  panelTx.addEventListener("click", (e) => {
    const tr = e.target.closest("tr[data-mid]");
    if (!tr || busy) return;
    clearActiveRow();
    tr.classList.add("active");
    selectByMid(Number(tr.dataset.mid), tr.dataset.pid || currentIdpar, true);
  });
});

let busy = false;
let currentIdpar = null;

async function onParcelClick(e) {
  const feats = e.features || [];
  if (!feats.length || busy) return;
  // Overlapping features at the click point: select the SMALLEST parcel.
  const f = feats.reduce((a, b) =>
    Number(b.properties.area) < Number(a.properties.area) ? b : a);
  const { idpar, coddep, prix, area } = f.properties;
  currentIdpar = idpar;
  selectByMid(f.properties.mid, idpar, false);
  panelTitle.textContent = `Parcelle ${idpar}`;
  panelMeta.innerHTML = metaHtml({ coddep, prix, area });
  panelTx.innerHTML = '<p class="muted">Chargement des mutations…</p>';
  panelEl.classList.remove("hidden");

  busy = true;
  try {
    const rows = await queryTx(coddep, idpar);
    panelTx.innerHTML = rows.length ? txTable(rows, idpar) : '<p class="muted">Aucune mutation trouvée.</p>';
  } catch (err) {
    panelTx.innerHTML = `<p class="err">Erreur : ${escapeHtml(err.message)}</p>`;
  } finally {
    busy = false;
  }
}

// Highlight the MVT feature for `mid`; fit the camera if `doZoom`.
// setFilter is async (repaints next frame), so query after a short delay.
// If no feature matches `mid` (dropped by tippecanoe), fall back to `idpar`.
function selectByMid(mid, idpar, doZoom) {
  map.setFilter("parcels-selected", ["==", ["get", "mid"], mid]);
  setTimeout(() => {
    const feats = map.queryRenderedFeatures(null, { layers: ["parcels-selected"] });
    if (feats.length) {
      if (doZoom) fitToFeatures(feats);
    } else {
      map.setFilter("parcels-selected", ["==", ["get", "idpar"], idpar]);
      setTimeout(() => {
        const fb = map.queryRenderedFeatures(null, { layers: ["parcels-selected"] });
        if (doZoom && fb.length) fitToFeatures(fb);
      }, 100);
    }
  }, 100);
}

function fitToFeatures(feats) {
  const b = new maplibregl.LngLatBounds();
  for (const f of feats) extendBounds(b, f.geometry);
  if (b.isEmpty()) return;
  map.fitBounds(b, { padding: 80, duration: 500, maxZoom: 17 });
}

function extendBounds(b, g) {
  const walk = (c) => (typeof c[0] === "number" ? b.extend([c[0], c[1]]) : c.forEach(walk));
  if (g.type === "Point") b.extend([g.coordinates[0], g.coordinates[1]]);
  else walk(g.coordinates);
}

function clearActiveRow() {
  panelTx.querySelectorAll("tr.active").forEach((tr) => tr.classList.remove("active"));
}

function clearSelection() {
  map.setFilter("parcels-selected", ["==", ["get", "idpar"], ""]);
  panelEl.classList.add("hidden");
  currentIdpar = null;
}

function metaHtml({ coddep, prix, area }) {
  let h = `<div>Department : <b>${escapeHtml(String(coddep))}</b></div>`;
  if (prix != null) h += `<div>Prix (dernier) : <b>${fmt(prix)} €</b></div>`;
  if (area != null) h += `<div>Surface : <b>${fmt(area)} m²</b></div>`;
  return h;
}

function txTable(rows, currentIdpar) {
  let h =
    '<p class="hint">Cliquez sur une mutation pour sélectionner sa parcelle réelle.</p>' +
    '<table><thead><tr><th>Date</th><th>Prix</th><th>Type</th><th>Surface</th></tr></thead><tbody>';
  for (const r of rows) {
    let d = r.datemut;
    if (typeof d === "number") d = new Date(d).toISOString().slice(0, 10);
    else if (d instanceof Date) d = d.toISOString().slice(0, 10);
    let otherIds = "";
    if (r.ids_str) {
      const ids = r.ids_str.split(" ").filter(id => id !== currentIdpar);
      if (ids.length) otherIds = `<div class="other-ids">${ids.map(id => escapeHtml(id)).join(", ")}</div>`;
    }
    h += `<tr data-mid="${r.mid}" data-pid="${r.pid}"><td>${escapeHtml(String(d))}${otherIds}</td>`;
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
