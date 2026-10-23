# DVF+ · Parcelles & mutations foncières

[![E2E Tests](https://github.com/pierre-lamarche/dvf-viz/actions/workflows/e2e-tests.yml/badge.svg)](https://github.com/pierre-lamarche/dvf-viz/actions/workflows/e2e-tests.yml)
[![codecov](https://codecov.io/gh/pierre-lamarche/dvf-viz/branch/main/graph/badge.svg)](https://codecov.io/gh/pierre-lamarche/dvf-viz)

Carte interactive des **parcelles françaises ayant connu au moins une mutation foncière**
(ventes immobilières), d'après le jeu de données **DVF+** (*Demandes des Valeurs Foncières plus*)
publié par le Céréma.

Cliquez sur une parcelle : elle se surligne et un panneau affiche l'historique de ses mutations
(date, prix, type de bien, surface — bâtie pour les biens construits, terrain pour les terrains).

🌐 **Site en ligne** : <https://pierre-lamarche.github.io/dvf-viz/>

## Fonctionnalités

- **Fond de carte** léger (CARTO Light) sur lequel les parcelles sont dessinées en gris.
- **Au clic** sur une parcelle : surlignage + panneau listant ses mutations.
- **100 % côté client** : le moteur d'analyse **DuckDB-WASM** s'exécute dans le navigateur,
  aucune base de données serveur.
- **Données** servies depuis un bucket **MinIO/S3 public** (tuiles MVT + shards Parquet).
- **Site statique** : l'app est déployable sur n'importe quel hébergement / CDN.

## Tests E2E

```bash
cd app
npm install
npx playwright install chromium   # une seule fois
npm run dev                       # terminal 1
npm run test:e2e                  # terminal 2
```

Le CI (`.github/workflows/e2e-tests.yml`) relance la suite automatiquement après chaque
déploiement sur GitHub Pages, contre l'URL de production.

## Stack

| Composant | Rôle |
|-----------|------|
| [MapLibre GL JS](https://maplibre.org/) | rendu de la carte (tuiles vectorielles MVT) |
| [CARTO Light](https://carto.com/developers/basemaps-api/) | fond de carte raster (clé API gratuite) |
| [DuckDB-WASM](https://duckdb.org/docs/guides/wasm) | requêtes SQL des mutations dans le navigateur |
| [Vite](https://vitejs.dev/) | build de l'app statique |
| [DuckDB](https://duckdb.org/) (Python) + [tippecanoe](https://github.com/felt/tippecanoe) | pipeline de génération des données |

## Démarrage rapide

Prérequis : **Node.js ≥ 18**.

Le répertoire `out/` (≈ 5 Go de données) n'est **pas** dans le dépôt. Deux façons d'obtenir
les données :

### Option A — lire les données depuis MinIO (recommandé pour un clone frais)

```bash
cd app
npm install
# Créez app/.env.local (ignoré par git) :
#   VITE_DATA_BASE=https://minio.lab.sspcloud.fr/pierrelamarche/dvf/dvfplus/app
#   VITE_CARTO_KEY=votre_cle_carto
npm run dev
```

### Option B — données locales (`out/` déjà généré)

```bash
cd app
npm install
npm run dev    # Vite sert ../out/tiles et ../out/tx automatiquement
```

Ouvrez `http://localhost:5173`. Quand le statut passe à *« prêt »*, cliquez sur une parcelle.

> **Clé de fond de carte CARTO** (gratuite, sans compte) : <https://carto.com/basemaps/apikey/>.
> Sans elle, le fond de carte renvoie « API key required ». En local, elle va dans
> `app/.env.local` sous `VITE_CARTO_KEY`.

## Structure du projet

```
dvf-viz/
├── app/                    # l'application (Vite + MapLibre + DuckDB-WASM)
│   ├── src/
│   │   ├── main.js         # carte, couches, gestion du clic, panneau
│   │   ├── config.js       # URL des données (VITE_DATA_BASE) et du bundle DuckDB
│   │   ├── duckdb.js       # init DuckDB-WASM + chargement des shards + requêtes
│   │   └── style.css
│   ├── index.html
│   ├── scripts/copy-duckdb.mjs   # copie le wasm dans public/duckdb (avant dev/build)
│   ├── tests/e2e.cjs             # tests E2E Playwright (9 cas)
│   └── vite.config.js      # base "./" + middleware de dev servant ../out
├── build/                  # pipeline de génération des données
│   ├── extract.py          # parquet DVF+ → GeoJSON (parcelles) + shard Parquet (mutations)
│   ├── run_all.sh          # lance extract.py en parallèle (97 départements)
│   ├── unpack_mbtiles.py   # mbtiles (tippecanoe) → tuiles MVT {z}/{x}/{y}.mvt
│   └── fix_tx.py           # correction ponctuelle du type idpar
├── out/                    # données générées (GITIGNORED) : tiles/  tx/  parcels/
├── .github/workflows/      # CI : vérif données → build → deploy GitHub Pages
├── DEPLOY.md               # guide de déploiement détaillé
└── LICENSE                 # MIT (code)
```

## Pipeline de données

1. **Source** : DVF+ en Parquet sur MinIO, partitionné par département, géométrie en EPSG:2154.
2. `build/extract.py` (DuckDB) : pour chaque département, télécharge le Parquet une fois et produit
   - `out/parcels/dept-NN.geojson` — polygones des parcelles (simplifiés, EPSG:4326),
    - `out/tx/dept-NN.parquet` — shard des mutations (une ligne par mutation, `idpar` = `l_idpar[1]`, sans géométrie).
3. `build/run_all.sh` : exécute `extract.py` en parallèle sur les **97 départements**.
4. **tippecanoe** : `out/parcels/*.geojson` → `mbtiles` (z0–z14), avec
   `--name=parcels --layer=parcels --drop-densest-as-needed` (une seule couche `parcels` ;
   `--drop-densest-as-needed` est **requis** pour que les tuiles denses comme Paris passent à
   z9+ — le zoom 14, max de l'app, garde toutes les parcelles).
5. `build/unpack_mbtiles.py` : `mbtiles` → `out/tiles/{z}/{x}/{y}.mvt` (MVT brut, non gzippé).

> Les **appartements** sont inclus : la parcelle affichée est `l_idpar[1]` (la parcelle du bien),
> pas `l_idparmut` (les parcelles modifiées par la mutation — vides pour ~99,9 % des ventes
> d'appartements, ce qui les faisait disparaître de la carte).

Résultat : **250 014 tuiles MVT** (≈ 3,5 Go) + **97 shards** `dept-NN.parquet` (≈ 547 Mo),
ensuite uploadés sur MinIO (voir `DEPLOY.md`).

## Déploiement

Voir **[`DEPLOY.md`](DEPLOY.md)** pour le guide complet (upload MinIO, build, hébergement).

En synthèse, le CI (`.github/workflows/deploy-pages.yml`) déploie sur **GitHub Pages** à chaque
push sur `main` :

1. **`check-data`** — vérifie que les données sont bien sur MinIO (compte des objets par listing
   anonyme, le bucket étant public). Annule le déploiement sinon.
2. **`build-deploy`** — build l'app (`VITE_DATA_BASE` + `VITE_CARTO_KEY`) et la publie.

Prérequis GitHub (une seule fois) : *Settings → Pages → Source : GitHub Actions*, et le secret
`CARTO_KEY` (clé de fond de carte).

## Comment ça marche (côté client)

- MapLibre charge le fond de carte CARTO (raster) et la couche *parcels* (MVT depuis MinIO),
  dessinée en gris.
- Au chargement, **DuckDB-WASM** (41 Mo, embarqué dans le bundle) s'initialise.
- Au clic sur une parcelle : l'app télécharge **une seule fois** le shard Parquet du département
  concerné, le charge dans une table DuckDB en mémoire, puis exécute une requête SQL pour n'afficher
  que les mutations de cette parcelle.

## Données & licences

- **Code** : MIT (voir `LICENSE`).
- **Données DVF+** : © État français, sous **Licence Ouverte** —
  [data.economie.gouv.fr](https://data.economie.gouv.fr/). Ce projet ne redistribue pas les
  données brutes (elles restent sur le bucket MinIO).
- **Fond de carte** : [CARTO Light](https://carto.com/), avec attribution.
