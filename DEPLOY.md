# Déploiement — DVF+ viz

La carte est une **app statique** (Vite + MapLibre + DuckDB-WASM). Elle lit les
données (MVT + shards parquet) depuis **MinIO** et embarque le moteur DuckDB-WASM
(41 Mo de wasm, copié dans le bundle).

## Artefacts produits

| Répertoire          | Contenu                              | Taille   | Usage            |
|---------------------|--------------------------------------|----------|------------------|
| `out/tiles/`        | 249 927 tuiles MVT `{z}/{x}/{y}.mvt` | 4.3 Go   | → MinIO          |
| `out/tx/`           | 97 shards `dept-NN.parquet`          | 808 Mo   | → MinIO          |
| `app/dist/`         | app statique (build)                 | 42 Mo    | → hébergement web|

## 1. Uploader les données sur MinIO

Base cible : `pierrelamarche/dvf/dvfplus/app/`

Avec le **CLI AWS** (`aws` v2 — MinIO est compatible S3) :

```bash
aws s3 sync --no-progress --delete out/tiles s3://pierrelamarche/dvf/dvfplus/app/tiles
aws s3 sync --no-progress --delete out/tx    s3://pierrelamarche/dvf/dvfplus/app/tx
```

> `s3 sync` est idempotent (n'envoie que ce qui a changé) ; `--delete` supprime
> les objets distants absents localement. Le CLI AWS v2 utilise le **path-style**
> par défaut avec un endpoint custom. En cas d'erreur de résolution de nom,
> force-le dans `~/.aws/config` : section `[default]` → `s3 =` / `address_style = path`.

Cela crée :
- `https://minio.lab.sspcloud.fr/pierrelamarche/dvf/dvfplus/app/tiles/{z}/{x}/{y}.mvt`
- `https://minio.lab.sspcloud.fr/pierrelamarche/dvf/dvfplus/app/tx/dept-{NN}.parquet`

> Le bucket `pierrelamarche` a déjà CORS ouvert (vérifié). MapLibre fait un
> `fetch` des MVT et l'app un `fetch` des shards → tout passe.

## 2. Builder l'app en pointant vers MinIO

```bash
cd app
VITE_DATA_BASE="https://minio.lab.sspcloud.fr/pierrelamarche/dvf/dvfplus/app" npm run build
```

`VITE_DATA_BASE` préfixe les URLs des tuiles et des shards. Le wasm DuckDB est
servi en relatif depuis l'origine de l'app (`/duckdb/…`), donc il suit l'app.

## 3. Déployer `app/dist/`

N'importe quel hébergement statique (GitHub Pages, Netlify, S3, …). `base: "./"`
est configuré → les assets sont en chemin relatif, ça marche dans un sous-chemin.

```bash
# ex. rsync vers un serveur web
rsync -az --delete app/dist/ user@host:/var/www/dvf-viz/
```

## 3bis. Déploiement automatique via GitHub Actions

`.github/workflows/deploy-pages.yml` déploie sur **GitHub Pages** à chaque push
sur `main` (ou à la main via *Actions → Run workflow*). Avant de builder, un job
vérifie que les données sont bien sur MinIO ; sinon le deploy est annulé.

Le bucket MinIO étant **public** (lecture anonyme autorisée), **aucun identifiant
S3 n'est nécessaire** : le job de vérification compte simplement les objets via
l'API `ListObjectsV2` (en `curl`, sans credentials).

Prérequis (une seule fois) :
1. **Settings → Pages → Build and deployment → Source : `GitHub Actions`**.

Le workflow lit le endpoint/bucket/préfixe et les counts attendus depuis le bloc
`env:` en tête du workflow (`MINIO_ENDPOINT`, `MINIO_BUCKET`, `EXPECTED_TILES`,
`EXPECTED_TX`) — à mettre à jour si la base de données change. La vérification
compte les tuiles par pagination (~1-2 min).

## Démo locale (sans MinIO)

```bash
cd app && npm install && npm run dev
```

Le dev server Vite sert `../out/tiles` et `../out/tx` automatiquement
(middleware dans `vite.config.js`), donc pas besoin de MinIO en local.

## Tests

- Build de prod : `cd app && npm run build`
- E2E headless (Chromium) : voir `/tmp/opencode/pwtest/e2e.cjs` (charge l'app,
  attend DuckDB, clique une parcelle, vérifie le panneau de mutations).

## Notes techniques

- Tuiles MVT **brutes** (déjà dé-gzippées) — MapLibre les consomme telles quelles.
- Les shards `dept-NN.parquet` : 1 ligne par parcelle × mutation, colonnes
  `idpar, idmutation, datemut, annee, prix, type, surface, ids`.
- `idpar` = identifiant cadastre (alnum) ; la recherche dans DuckDB-WASM utilise
  l'id inline (validé alnum) car le binding de paramètres préparés est cassé
  dans le build `1.33.1-dev57.0` de DuckDB-WASM.
