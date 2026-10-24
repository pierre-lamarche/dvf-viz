#!/usr/bin/env python3
"""Add a formatted `adresse` column to existing tx shards.

Reads adresse.parquet, builds a one-row-per-mutation lookup, then
LEFT JOINs each tx shard to add the address string.

Usage: python3 add_adresse.py [DEPT ...]
Env:   TX_DIR (default out/tx), ADRESSE_URL
"""
import duckdb, glob, os, sys, time

TX_DIR = os.environ.get("TX_DIR", "out/tx")
ADRESSE_URL = os.environ.get(
    "ADRESSE_URL",
    "https://minio.lab.sspcloud.fr/pierrelamarche/dvf/dvfplus/202610/adresse.parquet",
)


def parse_args():
    return sys.argv[1:] if len(sys.argv) > 1 else []


def main():
    depts = parse_args()
    con = duckdb.connect()
    con.execute("SET memory_limit = '32GB'")

    # Load one address per mutation (first by idadresse)
    print("Loading adresse.parquet (29.6M rows) ...", flush=True)
    t0 = time.time()
    con.execute(f"""
        CREATE TEMP TABLE addr AS
        SELECT idmutation,
               (CASE WHEN novoie IS NOT NULL AND novoie != ''
                     THEN novoie || ' '
                     ELSE '' END) || typvoie || ' ' || voie || ', ' ||
               codepostal || ' ' || commune AS adresse
        FROM (
            SELECT *, ROW_NUMBER() OVER (PARTITION BY idmutation ORDER BY idadresse) AS rn
            FROM read_parquet('{ADRESSE_URL}')
        )
        WHERE rn = 1
    """)
    n = con.execute("SELECT count(*) FROM addr").fetchone()[0]
    print(f"  {n:,} unique addresses ({time.time()-t0:.0f}s)", flush=True)

    if depts:
        files = [os.path.join(TX_DIR, f"dept-{d}.parquet") for d in depts]
    else:
        files = sorted(glob.glob(os.path.join(TX_DIR, "dept-*.parquet")))

    t0 = time.time()
    for f in files:
        tmp = f + ".tmp"
        con.execute(f"""
            COPY (
                SELECT t.idpar, t.idmutation, t.datemut, t.annee,
                       t.prix, t.type, t.surface, t.ids, a.adresse
                FROM read_parquet('{f}') t
                LEFT JOIN addr a ON t.idmutation = a.idmutation
            ) TO '{tmp}' (FORMAT parquet)
        """)
        os.replace(tmp, f)

    print(f"DONE {len(files)} shards ({time.time()-t0:.0f}s)", flush=True)


if __name__ == "__main__":
    main()
