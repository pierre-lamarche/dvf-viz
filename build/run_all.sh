#!/usr/bin/env bash
# Extract all departments (geojson -> scratch, tx shards -> out/tx), in parallel.
set -uo pipefail
cd "$(dirname "$0")/.."   # dvf-viz root
SCRATCH=/tmp/opencode/build
export PARCELS_DIR="$SCRATCH/parcels"
export TX_DIR="$PWD/out/tx"
mkdir -p "$PARCELS_DIR" "$TX_DIR" out/tiles
P="${P:-10}"
echo "Parallelism: $P | depts: $(wc -l < /tmp/opencode/depts.txt) | geojson -> $PARCELS_DIR"
time xargs -a /tmp/opencode/depts.txt -P "$P" -n 10 python3 build/extract.py
echo "=== outputs ==="
echo "geojson files: $(ls "$PARCELS_DIR" | wc -l)  total: $(du -sh "$PARCELS_DIR" | cut -f1)"
echo "tx shards:     $(ls "$TX_DIR" | wc -l)   total: $(du -sh "$TX_DIR" | cut -f1)"
