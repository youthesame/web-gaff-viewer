# GAFF Viewer

An interactive, static 3D viewer for visualizing GAFF (General Amber Force Field) atom types and RESP partial charges. It loads SYBYL mol2 files and renders them with [3Dmol.js](https://3dmol.csb.pitt.edu/). No build step required (no npm/bundler) — it runs on CDN dependencies only.

**Live demo:** https://youthesame.github.io/web-gaff-viewer/

## Usage

1. The viewer starts with a bundled `BTBT` sample. Load your own mol2 file via the "Open file…" button or by dragging and dropping it onto the viewer — this replaces `BTBT` in the dropdown with your molecule. Loaded molecules can be removed again with the "Remove" button.
2. The molecule structure is always rendered as CPK-colored ball-and-stick (standard element colors), regardless of display mode. Switch between two display modes for how atom-level data is shown:
   - **GAFF type**: each atom is labeled with its GAFF atom type (`ca`, `cc`, `ss`, `ha`, …).
   - **Charge**: semi-transparent spheres are overlaid on the unchanged structure — sign of the RESP partial charge is shown by color (negative = red, positive = blue, near-zero = white) and magnitude by sphere size. Labels show the charge value.
3. Use the "Labels" toggle to show/hide labels.
4. The atom table in the side panel lists every atom (name, element, GAFF type, charge). Clicking a row highlights the corresponding atom in the 3D view.

## Running locally

Serve this directory over HTTP and open it in a browser (mol2 files are loaded via `fetch`, so `file://` will not work).

```bash
python3 -m http.server 8000
```

Then visit `http://localhost:8000/`.

## Adding your own sample molecules

Drop a `.mol2` file into `mol2/` and add one entry to `BUILTIN_MOLECULES` in `js/app.js`, or just load it at runtime via "Open file…" / drag-and-drop.

## Project structure

- `index.html` — page shell (3D viewer + side panel)
- `style.css` — styles
- `js/app.js` — application logic (3Dmol.js control, labels, table, molecule list management)
- `js/mol2.js` — mol2 parser (extracts GAFF types and charges)
- `mol2/*.mol2` — sample mol2 files (`BTBT` is loaded by default; `DTBDT` is included as an extra sample you can load manually)
