# GAFF Viewer

An interactive, static 3D viewer for visualizing GAFF (General Amber Force Field) atom types and RESP partial charges. It loads SYBYL mol2 files and renders them with [3Dmol.js](https://3dmol.csb.pitt.edu/). No build step required (no npm/bundler) — it runs on CDN dependencies only.

**Live demo:** https://youthesame.github.io/web-gaff-viewer/

## Usage

1. Pick a molecule (`BTBT` / `DTBDT`) from the dropdown, or load your own mol2 file via the "ファイルを開く…" button or by dragging and dropping it onto the viewer.
2. Switch between two display modes:
   - **GAFF type**: atoms are colored by their GAFF atom type (`ca`, `cc`, `ss`, `ha`, …), with the type name labeled next to each atom.
   - **Charge**: the sign of the RESP partial charge is shown by color (negative = red, positive = blue, near-zero = white) and its magnitude by sphere size. Labels show the charge value.
3. Use the "ラベル表示" toggle to show/hide labels.
4. The atom table in the side panel lists every atom (name, element, GAFF type, charge). Clicking a row highlights the corresponding atom in the 3D view.

## Running locally

Serve this directory over HTTP and open it in a browser (mol2 files are loaded via `fetch`, so `file://` will not work).

```bash
python3 -m http.server 8000
```

Then visit `http://localhost:8000/`.

## Adding your own sample molecules

Drop a `.mol2` file into `mol2/` and add one entry to the molecule list in `js/app.js`.

## Project structure

- `index.html` — page shell (3D viewer + side panel)
- `style.css` — styles
- `js/app.js` — application logic (3Dmol.js control, coloring, labels, table)
- `js/mol2.js` — mol2 parser (extracts GAFF types and charges)
- `mol2/*.mol2` — sample molecules (BTBT, DTBDT)
