import { parseMol2 } from './mol2.js';

// --- Molecule sources -------------------------------------------------------
const BUILTIN_MOLECULES = { BTBT: 'mol2/BTBT.mol2' };
const userTexts = {}; // name -> raw mol2 text (loaded via drag&drop / file picker)

// --- Charge mode: diverging color map + radius mapping ----------------------
function mixHex(c1, c2, t) {
  const r1 = (c1 >> 16) & 255, g1 = (c1 >> 8) & 255, b1 = c1 & 255;
  const r2 = (c2 >> 16) & 255, g2 = (c2 >> 8) & 255, b2 = c2 & 255;
  const r = Math.round(r1 + (r2 - r1) * t);
  const g = Math.round(g1 + (g2 - g1) * t);
  const b = Math.round(b1 + (b2 - b1) * t);
  return (r << 16) | (g << 8) | b;
}

const WHITE = 0xffffff, RED = 0xff5c5c, BLUE = 0x4f8fff;

function colorForCharge(charge, maxAbs) {
  const t = maxAbs > 0 ? charge / maxAbs : 0;
  return t < 0 ? mixHex(WHITE, RED, Math.min(1, -t)) : mixHex(WHITE, BLUE, Math.min(1, t));
}

const CHARGE_BASE_RADIUS = 0.22;
const CHARGE_RADIUS_SCALE = 0.9;
const CHARGE_OVERLAY_ALPHA = 0.5;

function radiusForCharge(charge, maxAbs) {
  const norm = maxAbs > 0 ? Math.abs(charge) / maxAbs : 0;
  return CHARGE_BASE_RADIUS + CHARGE_RADIUS_SCALE * norm;
}

const STICK_RADIUS = 0.13;
const SPHERE_SCALE = 0.22;
const HIGHLIGHT_RADIUS = 0.55;
const HIGHLIGHT_EXTRA = 0.35;

// --- App state ---------------------------------------------------------------
let viewer = null;
let currentParsed = null;
let mode = 'gaff'; // 'gaff' | 'charge'
let labelsOn = true;
let highlightShape = null;
let activeRowIdx = null;
let chargeShapes = []; // semi-transparent overlay spheres shown in charge mode

const el = {
  select: document.getElementById('molecule-select'),
  fileInput: document.getElementById('file-input'),
  removeBtn: document.getElementById('remove-btn'),
  viewerContainer: document.getElementById('viewer-container'),
  modeSeg: document.getElementById('mode-segmented'),
  labelToggle: document.getElementById('label-toggle'),
  tableBody: document.getElementById('atom-table-body'),
};

function initViewer() {
  viewer = $3Dmol.createViewer(document.getElementById('viewer'), { backgroundColor: '#1a1e28' });
  window.addEventListener('resize', () => viewer.resize());
}

function maxAbsCharge(atoms) {
  let m = 0;
  for (const a of atoms) m = Math.max(m, Math.abs(a.charge));
  return m || 1e-6;
}

// Base structure is always CPK ball-and-stick, independent of display mode.
// 3Dmol's mol2 parser guesses element from the SYBYL type column, which for GAFF
// files holds force-field types (e.g. "ca", "ss") rather than real SYBYL types and
// gets misread as unrelated elements (Ca, ...). Fix up .elem from our own parser
// (which reads the real element) before applying the Jmol CPK colorscheme.
function applyStyle() {
  const model = viewer.getModel();
  if (!model) return;
  const elemBySerial = {};
  currentParsed.atoms.forEach((p) => { elemBySerial[p.id] = p.element; });
  model.selectedAtoms({}).forEach((a) => {
    if (elemBySerial[a.serial]) a.elem = elemBySerial[a.serial];
  });
  viewer.setStyle({}, {
    stick: { radius: STICK_RADIUS, colorscheme: 'Jmol' },
    sphere: { scale: SPHERE_SCALE, colorscheme: 'Jmol' },
  });
}

function clearChargeOverlay() {
  chargeShapes.forEach((s) => viewer.removeShape(s));
  chargeShapes = [];
}

// Charge mode adds semi-transparent spheres on top of the unchanged CPK structure.
function applyChargeOverlay() {
  clearChargeOverlay();
  if (mode !== 'charge' || !currentParsed) return;
  const maxAbs = maxAbsCharge(currentParsed.atoms);
  currentParsed.atoms.forEach((p) => {
    chargeShapes.push(viewer.addSphere({
      center: { x: p.x, y: p.y, z: p.z },
      radius: radiusForCharge(p.charge, maxAbs),
      color: colorForCharge(p.charge, maxAbs),
      alpha: CHARGE_OVERLAY_ALPHA,
    }));
  });
}

function applyLabels() {
  viewer.removeAllLabels();
  if (labelsOn && currentParsed) {
    currentParsed.atoms.forEach((p) => {
      const text = mode === 'gaff' ? p.gaffType : p.charge.toFixed(Math.abs(p.charge) < 0.1 ? 3 : 2);
      viewer.addLabel(text, {
        position: { x: p.x, y: p.y, z: p.z },
        fontSize: 11,
        fontColor: 'white',
        backgroundColor: 'black',
        backgroundOpacity: 0.55,
        inFront: true,
        showBackground: true,
      });
    });
  }
  reapplyHighlight();
  viewer.render();
}

function highlightAtom(idx) {
  if (highlightShape) {
    viewer.removeShape(highlightShape);
    highlightShape = null;
  }
  const p = currentParsed && currentParsed.atoms[idx];
  if (!p) return;
  highlightShape = viewer.addSphere({
    center: { x: p.x, y: p.y, z: p.z },
    radius: HIGHLIGHT_RADIUS + HIGHLIGHT_EXTRA,
    color: 0xffee00,
    alpha: 0.35,
  });
}

function reapplyHighlight() {
  if (activeRowIdx !== null) highlightAtom(activeRowIdx);
}

function clearHighlight() {
  if (highlightShape) {
    viewer.removeShape(highlightShape);
    highlightShape = null;
  }
  activeRowIdx = null;
  document.querySelectorAll('#atom-table-body tr.active-row').forEach((tr) => tr.classList.remove('active-row'));
}

function selectRow(idx) {
  document.querySelectorAll('#atom-table-body tr.active-row').forEach((tr) => tr.classList.remove('active-row'));
  const tr = el.tableBody.children[idx];
  if (tr) {
    tr.classList.add('active-row');
    tr.scrollIntoView({ block: 'nearest' });
  }
  activeRowIdx = idx;
  highlightAtom(idx);
  viewer.render();
}

function buildTable(parsed) {
  el.tableBody.innerHTML = '';
  parsed.atoms.forEach((p, i) => {
    const tr = document.createElement('tr');
    const chargeClass = p.charge < 0 ? 'charge-neg' : 'charge-pos';
    tr.innerHTML = `<td>${i + 1}</td><td>${p.name}</td><td>${p.element}</td><td>${p.gaffType}</td><td class="${chargeClass}">${p.charge.toFixed(4)}</td>`;
    tr.addEventListener('click', () => selectRow(i));
    el.tableBody.appendChild(tr);
  });
}

function renderMolecule(text, name) {
  currentParsed = parseMol2(text);
  clearHighlight();
  clearChargeOverlay();
  viewer.clear();
  viewer.addModel(text, 'mol2');
  applyStyle();
  applyChargeOverlay();
  applyLabels();
  viewer.zoomTo();
  viewer.render();
  buildTable(currentParsed);
  el.viewerContainer.classList.remove('empty');
}

function showEmptyState() {
  currentParsed = null;
  clearHighlight();
  clearChargeOverlay();
  if (viewer.getModel()) viewer.clear();
  viewer.render();
  el.tableBody.innerHTML = '';
  el.viewerContainer.classList.add('empty');
}

async function loadByName(name) {
  const text = userTexts[name] !== undefined ? userTexts[name] : await fetch(BUILTIN_MOLECULES[name]).then((r) => r.text());
  renderMolecule(text, name);
}

function addOptionIfMissing(name) {
  if ([...el.select.options].some((o) => o.value === name)) return;
  const opt = document.createElement('option');
  opt.value = name;
  opt.textContent = name;
  el.select.appendChild(opt);
}

function removeMolecule(name) {
  delete userTexts[name];
  const opt = [...el.select.options].find((o) => o.value === name);
  if (opt) opt.remove();
}

function handleFile(file) {
  file.text().then((text) => {
    const name = file.name.replace(/\.mol2$/i, '');
    userTexts[name] = text;
    addOptionIfMissing(name);
    // A user molecule replaces the bundled BTBT sample in the list.
    if (name !== 'BTBT') removeMolecule('BTBT');
    el.select.value = name;
    renderMolecule(text, name);
  });
}

function handleRemove() {
  const name = el.select.value;
  if (!name) return;
  removeMolecule(name);
  const remaining = [...el.select.options];
  if (remaining.length) {
    el.select.value = remaining[0].value;
    loadByName(remaining[0].value);
  } else {
    showEmptyState();
  }
}

function setMode(newMode) {
  mode = newMode;
  el.modeSeg.querySelectorAll('.segmented-btn').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.mode === mode);
  });
  applyChargeOverlay();
  applyLabels();
  reapplyHighlight();
  viewer.render();
}

function initControls() {
  Object.keys(BUILTIN_MOLECULES).forEach((name) => addOptionIfMissing(name));
  el.select.value = 'BTBT';
  el.select.addEventListener('change', () => loadByName(el.select.value));

  el.fileInput.addEventListener('change', () => {
    if (el.fileInput.files.length) handleFile(el.fileInput.files[0]);
    el.fileInput.value = '';
  });

  el.removeBtn.addEventListener('click', handleRemove);

  el.modeSeg.querySelectorAll('.segmented-btn').forEach((btn) => {
    btn.addEventListener('click', () => setMode(btn.dataset.mode));
  });

  el.labelToggle.addEventListener('change', () => {
    labelsOn = el.labelToggle.checked;
    applyLabels();
    viewer.render();
  });

  const dz = el.viewerContainer;
  ['dragenter', 'dragover'].forEach((evt) => {
    dz.addEventListener(evt, (e) => {
      e.preventDefault();
      dz.classList.add('drag-over');
    });
  });
  ['dragleave', 'drop'].forEach((evt) => {
    dz.addEventListener(evt, (e) => {
      e.preventDefault();
      dz.classList.remove('drag-over');
    });
  });
  dz.addEventListener('drop', (e) => {
    const file = e.dataTransfer.files && e.dataTransfer.files[0];
    if (file) handleFile(file);
  });
}

initViewer();
initControls();
loadByName('BTBT');
