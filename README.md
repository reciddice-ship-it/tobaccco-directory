# Tobacco Product Registry Watch

A static GitHub Pages-ready dashboard for the FDA Searchable Tobacco Products Database.

The page loads the generated FDA snapshot from `data/current.json`, searches previously listed products, visualizes authorization patterns, and highlights records added since the previous scan using `data/changes.json`.

## Local update

```sh
node scripts/update-data.mjs
```

The updater downloads the FDA export, normalizes records, compares them to the previous snapshot, and rewrites:

- `data/current.json`
- `data/changes.json`
- `data/fda-tobacco-products.csv`

## GitHub Pages

1. Push this folder to a GitHub repository.
2. In repository settings, enable Pages from the default branch.
3. The included GitHub Actions workflow runs daily and can also be started manually from the Actions tab.

The first scan establishes a baseline. Later scans flag newly added FDA records.
