#!/usr/bin/env python3
"""Per department, extract:
  - $PARCELS_DIR/dept-NN.geojson : simplified EPSG:4326 parcel footprints (one feature per mutation)
  - $TX_DIR/dept-NN.parquet      : lean tx shard (one row per (parcel, mutation)), no geometry

Each parquet is downloaded once (materialized to a temp table), then both outputs derive from it.

Usage: python3 extract.py DEPT [DEPT ...] [--tol M] [--limit N]
Env:   PARCELS_DIR (default out/parcels), TX_DIR (default out/tx)
"""
import duckdb, json, os, sys, time

BASE = "https://minio.lab.sspcloud.fr/pierrelamarche/dvf/dvfplus/202610"
YEAR = "annee" + "mut"  # anneemut
SIMPLIFY_TOL = 2.0
LIMIT = None


def parse_args():
    global SIMPLIFY_TOL, LIMIT
    depts, i = [], 1
    while i < len(sys.argv):
        a = sys.argv[i]
        if a == "--tol":
            SIMPLIFY_TOL = float(sys.argv[i + 1]); i += 2; continue
        if a == "--limit":
            LIMIT = int(sys.argv[i + 1]); i += 2; continue
        depts.append(a); i += 1
    return depts


def extract(con, dept):
    t = time.time()
    url = f"{BASE}/departement%3D{dept}/part-0.parquet"
    lim = f" LIMIT {LIMIT}" if LIMIT else ""
    # download once, materialize the columns we need
    con.execute(
        "DROP TABLE IF EXISTS t; CREATE TEMP TABLE t AS SELECT "
        "idmutation, l_idpar, coddep, {yc}, valeurfonc, codtypbien, "
        "libtypbien, sterr, sbati, datemut, geompar "
        "FROM read_parquet('{u}') "
        "WHERE geompar IS NOT NULL AND l_idpar IS NOT NULL AND len(l_idpar) > 0{lim}".format(
            yc=YEAR, u=url, lim=lim)
    )
    # ---- parcel geojson (simplified in 2154, reprojected to 4326) ----
    q = ("SELECT l_idpar[1] AS idpar, coddep, {yc} AS annee, "
         "round(valeurfonc) AS prix, codtypbien AS typ, "
         "idmutation AS mid, round(ST_Area(geompar)) AS area, "
         "ST_AsGeoJSON(ST_Transform(ST_SimplifyPreserveTopology(geompar, {tol}), "
         "'EPSG:2154','EPSG:4326')) AS g FROM t").format(yc=YEAR, tol=SIMPLIFY_TOL)
    feats, nulls = [], 0
    for idpar, coddep, annee, prix, typ, mid, area, g in con.execute(q).fetchall():
        if g is None:
            nulls += 1; continue
        feats.append({
            "type": "Feature",
            "properties": {
                "idpar": idpar,
                "coddep": coddep,
                "annees": int(annee) if annee is not None else None,
                "prix": int(prix) if prix is not None else None,
                "type": typ,
                "mid": int(mid),
                "area": int(area) if area is not None else None,
            },
            "geometry": json.loads(g),
        })
    out_geo = os.path.join(os.environ.get("PARCELS_DIR", "out/parcels"), f"dept-{dept}.geojson")
    with open(out_geo, "w") as f:
        json.dump({"type": "FeatureCollection", "features": feats}, f, separators=(",", ":"))
    # ---- transaction shard (no geometry) ----
    out_tx = os.path.join(os.environ.get("TX_DIR", "out/tx"), f"dept-{dept}.parquet")
    con.execute(
        "COPY (SELECT l_idpar[1] AS idpar, idmutation, datemut, {yc} AS annee, "
        "round(valeurfonc) AS prix, libtypbien AS type, "
        "CASE WHEN codtypbien LIKE '12%' THEN sbati "
        "WHEN codtypbien LIKE '11%' OR codtypbien LIKE '14%' OR codtypbien LIKE '15%' THEN sbati "
        "WHEN codtypbien LIKE '2%' THEN sterr ELSE NULL END AS surface, "
        "l_idpar AS ids FROM t) "
        "TO '{o}' (FORMAT parquet)".format(yc=YEAR, o=out_tx)
    )
    print(f"[{dept}] done: {len(feats)} feats (geo {os.path.getsize(out_geo)/1e6:.0f} MB), "
          f"tx {os.path.getsize(out_tx)/1e6:.0f} MB, {time.time()-t:.0f}s", flush=True)


def main():
    depts = parse_args()
    con = duckdb.connect()
    con.execute("LOAD spatial")
    con.execute("SET geometry_always_xy = true")  # keep [lon, lat] / [X, Y]
    for dept in depts:
        try:
            extract(con, dept)
        except Exception as e:
            print(f"[{dept}] ERROR: {type(e).__name__}: {e}", flush=True)
    print(f"DONE {len(depts)} depts", flush=True)


if __name__ == "__main__":
    main()
