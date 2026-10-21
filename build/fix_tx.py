#!/usr/bin/env python3
"""Fix tx shards in place: idpar was a struct (UNNEST alias); re-copy with the scalar field."""
import duckdb, glob, os

con = duckdb.connect()
files = sorted(glob.glob("out/tx/dept-*.parquet"))
for f in files:
    tmp = f + ".tmp"
    con.execute(
        f"COPY (SELECT idpar.unnest AS idpar, idmutation, datemut, annee, prix, type, surface, ids "
        f"FROM read_parquet('{f}')) TO '{tmp}' (FORMAT parquet)"
    )
    os.replace(tmp, f)
print(f"fixed {len(files)} tx shards")
