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

  initSearch();
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
  const clickPoint = { lat: e.lngLat.lat, lng: e.lngLat.lng };
  const codcom = String(idpar).slice(0, 5);
  currentIdpar = idpar;
  selectByMid(f.properties.mid, idpar, false);
  panelTitle.textContent = `Parcelle ${idpar}`;
  panelMeta.innerHTML = metaHtml({ codcom, libcom: "", prix, area });
  panelTx.innerHTML = '<p class="muted">Chargement des mutations…</p>';
  panelEl.classList.remove("hidden");

  busy = true;
  try {
    const rows = await queryTx(coddep, idpar);
    const firstAddr = (rows.find((r) => r.adresse) || {}).adresse || "";
    const [deptName, inseeCommune, streetPoint] = await Promise.all([
      getDeptName(coddep),
      getCommuneName(codcom),
      geocodeAddress(firstAddr),
    ]);
    const svPoint = streetPoint || clickPoint;
    panelTx.innerHTML = rows.length ? txTable(rows, idpar, svPoint) : '<p class="muted">Aucune mutation trouvée.</p>';
    panelMeta.innerHTML = metaHtml({ codcom, libcom: inseeCommune || firstCommune(rows), deptName: deptName || "", prix, area });
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

function metaHtml({ codcom, libcom, deptName, prix, area }) {
  const dept = deptName ? `, ${deptName}` : "";
  const comm = libcom ? `${libcom} (${codcom})${dept}` : `… (${codcom})${dept}`;
  let h = `<div>Commune : <b>${escapeHtml(comm)}</b></div>`;
  if (prix != null) h += `<div>Prix (dernier) : <b>${fmt(prix)} €</b></div>`;
  if (area != null) h += `<div>Surface : <b>${fmt(area)} m²</b></div>`;
  return h;
}

// Commune name, derived from the parcel's tx address ("street, CP COMMUNE").
// The INSEE code is the first 5 chars of the cadastre parcel id (dept + commune).
function communeFromAdresse(adresse) {
  if (!adresse) return "";
  const m = String(adresse).match(/^.*\b(\d{5})\s+(.+)$/);
  return m ? m[2].trim() : "";
}
function firstCommune(rows) {
  for (const r of rows) {
    const c = communeFromAdresse(r.adresse);
    if (c) return c;
  }
  return "";
}

// Street only: drop the ", CP COMMUNE" suffix (the commune is shown separately
// in the panel header). Used for the per-mutation row display only — the data
// keeps the full address, which still feeds the commune-name fallback.
function streetOnly(adresse) {
  const s = String(adresse || "").trim();
  const m = s.match(/^(.*),\s*\d{5}\b[\s\S]*$/);
  return (m ? m[1] : s).trim();
}

// ── INSEE geo names (commune / département), adresse label as fallback ──
// The browser calls the INSEE metadonnées API directly on click. Names are
// cached for the session (successes) / 60 s (misses) to bound request volume.
// A null result means the caller falls back to the address-derived label.
const INSEE = "https://api.insee.fr/metadonnees/V2/geo";
const inseeCache = new Map(); // kind+code -> { name, ts, ok }
const INSEE_MISS_TTL = 60_000;

function sleep(ms) {
  return new Promise((res) => setTimeout(res, ms));
}

async function inseeName(url, retries = 3) {
  for (let i = 0; i < retries; i++) {
    try {
      const r = await fetch(url);
      if (r.status === 404) return null; // absent (arrondissement / deactivated code)
      if (!r.ok) throw new Error("HTTP " + r.status);
      const j = await r.json();
      return j.intitule || null;
    } catch (e) {
      if (i < retries - 1) await sleep(250 * (i + 1));
    }
  }
  return null;
}

function inseeCached(kind, code) {
  const key = kind + "/" + code;
  const now = Date.now();
  const hit = inseeCache.get(key);
  if (hit && (hit.ok || now - hit.ts < INSEE_MISS_TTL)) return Promise.resolve(hit.name);
  return inseeName(`${INSEE}/${kind}/${code}`).then((name) => {
    inseeCache.set(key, { name, ts: now, ok: !!name });
    return name;
  });
}

function getCommuneName(code) {
  return code ? inseeCached("commune", code) : Promise.resolve(null);
}
function getDeptName(code) {
  return code ? inseeCached("departement", code) : Promise.resolve(null);
}

// Geocode a full address to its road frontage (better for Street View than the
// raw parcel-centroid click point, which often has no SV coverage). Bounded by a
// timeout and never rejects; returns null to fall back to the click point.
async function geocodeAddress(adresse) {
  const q = String(adresse || "").trim();
  if (q.length < 3) return null;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 6000);
  try {
    const res = await fetch(
      `https://data.geopf.fr/geocodage/search?q=${encodeURIComponent(q)}&limit=1`,
      { signal: ctrl.signal },
    );
    if (!res.ok) return null;
    const data = await res.json();
    const [lon, lat] = (data.features || [])[0]?.geometry?.coordinates || [];
    return (lat != null && lon != null) ? { lat, lng: lon } : null;
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

function txTable(rows, currentIdpar, center) {
  const sv = center
    ? `https://www.google.com/maps/@${center.lat},${center.lng},3a,77y,0h,0t/data=!3m6!4b1!5m1!1e1`
    : "";
  let h =
    '<p class="hint">Cliquez sur une mutation pour sélectionner sa parcelle réelle.</p>' +
    '<table><thead><tr><th>Date</th><th>Prix</th><th>Type</th><th>Surface</th></tr></thead><tbody>';
  for (const r of rows) {
    let d = r.datemut;
    if (typeof d === "number") d = new Date(d).toISOString().slice(0, 10);
    else if (d instanceof Date) d = d.toISOString().slice(0, 10);
    const street = streetOnly(r.adresse);
    let sub = "";
    if (street) {
      sub = sv
        ? `<div class="adresse"><a href="${sv}" target="_blank" rel="noopener noreferrer">${escapeHtml(street)}</a></div>`
        : `<div class="adresse">${escapeHtml(street)}</div>`;
    }
    h += `<tr data-mid="${r.mid}" data-pid="${r.pid}"><td>${escapeHtml(String(d))}${sub}</td>`;
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

// ── Address search (geocoding) ─────────────────────────────────────────
let searchMarker = null;

function initSearch() {
  const input = document.getElementById("search");
  const results = document.getElementById("search-results");
  let timer = null;

  function close() { results.classList.add("hidden"); }

  function show(items) {
    if (!items.length) {
      results.innerHTML = '<div class="item muted">Aucun résultat</div>';
    } else {
      results.innerHTML = items.map((r, i) =>
        `<div class="item" data-i="${i}"><span class="label">${escapeHtml(r.properties.label)}</span><span class="score">${r.properties.score.toFixed(2)}</span></div>`
      ).join("");
    }
    results.classList.remove("hidden");
  }

  async function doSearch(q) {
    if (q.length < 3) { close(); return; }
    try {
      const res = await fetch(`https://data.geopf.fr/geocodage/search?q=${encodeURIComponent(q)}&limit=5`);
      const data = await res.json();
      show(data.features || []);
      results._items = data.features || [];
    } catch {
      results.innerHTML = '<div class="item muted">Erreur</div>';
      results.classList.remove("hidden");
    }
  }

  function selectItem(feature) {
    const [lon, lat] = feature.geometry.coordinates;
    close();
    input.value = feature.properties.label;
    if (searchMarker) searchMarker.remove();
    searchMarker = new maplibregl.Marker({ color: "#e74c3c" })
      .setLngLat([lon, lat])
      .setPopup(new maplibregl.Popup({ offset: 8 }).setText(feature.properties.label))
      .addTo(map);
    map.flyTo({ center: [lon, lat], zoom: 16, duration: 1500 });
  }

  input.addEventListener("input", () => {
    clearTimeout(timer);
    timer = setTimeout(() => doSearch(input.value.trim()), 400);
  });

  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && results._items?.length) selectItem(results._items[0]);
    if (e.key === "Escape") { close(); input.blur(); }
  });

  results.addEventListener("click", (e) => {
    const item = e.target.closest(".item[data-i]");
    if (item && results._items) selectItem(results._items[Number(item.dataset.i)]);
  });

  document.addEventListener("click", (e) => {
    if (!e.target.closest("#search") && !e.target.closest("#search-results")) close();
  });
}
