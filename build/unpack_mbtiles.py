#!/usr/bin/env python3
"""Unpack a tippecanoe mbtiles (TMS row order) into a /{z}/{x}/{y}.mvt directory (XYZ order).
Tippecanoe stores tiles gzip-compressed; we decompress to raw MVT (canonical, MapLibre-safe).
Usage: python3 unpack_mbtiles.py in.mbtiles out_dir
"""
import sqlite3, os, sys, gzip


def main():
    mb, outdir = sys.argv[1], sys.argv[2]
    con = sqlite3.connect(mb)
    n = 0
    for z, x, y, tile in con.execute("SELECT zoom_level, tile_column, tile_row, tile_data FROM tiles"):
        xy = (1 << z) - 1 - y  # mbtiles TMS row -> XYZ row
        if tile[:2] == b"\x1f\x8b":  # gzip magic -> decompress to raw MVT
            tile = gzip.decompress(tile)
        d = os.path.join(outdir, str(z), str(x))
        os.makedirs(d, exist_ok=True)
        with open(os.path.join(d, f"{xy}.mvt"), "wb") as f:
            f.write(tile)
        n += 1
    print(f"unpacked {n} tiles -> {outdir}")

if __name__ == "__main__":
    main()
