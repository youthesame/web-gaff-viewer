import { parseMol2 } from './mol2.js';

// --- 分子ソース定義 -------------------------------------------------------
const BUILTIN_MOLECULES = { BTBT: 'mol2/BTBT.mol2', DTBDT: 'mol2/DTBDT.mol2' };
const userTexts = {}; // name -> mol2生テキスト（ドラッグ&ドロップ/ファイル選択で読み込んだ分子）

// --- GAFF原子タイプ → 色 パレット ------------------------------------------
// よく使うタイプは固定色、それ以外はハッシュから自動生成（同タイプは常に同色）。
const GAFF_PALETTE = {
  // sp3/sp2/sp 炭素
  c: 0x9e9e9e, c1: 0x8d8d8d, c2: 0xababab, c3: 0xbdbdbd,
  // 芳香族炭素
  ca: 0x3d8f3d, cc: 0x4caf50, cd: 0x66bb6a, cp: 0x2e7d32, cq: 0x1b5e20,
  ce: 0x81c784, cf: 0x81c784, cg: 0x558b2f, ch: 0x558b2f,
  cu: 0x9ccc65, cv: 0x9ccc65, cx: 0x689f38, cy: 0x689f38, cz: 0x33691e,
  // 水素
  hc: 0xffffff, ha: 0xe0e0e0, h1: 0xf5f5f5, h2: 0xf5f5f5, h3: 0xf5f5f5,
  h4: 0xeeeeee, h5: 0xeeeeee, hn: 0xbbdefb, ho: 0xffe0b2, hs: 0xfff59d,
  hw: 0xb3e5fc, hp: 0xf5f5f5, hx: 0xf5f5f5,
  // 窒素
  n: 0x1976d2, n1: 0x1e88e5, n2: 0x2196f3, n3: 0x42a5f5, n4: 0x64b5f6,
  na: 0x0d47a1, nb: 0x1565c0, nc: 0x283593, nd: 0x303f9f, ne: 0x3949ab,
  nf: 0x3949ab, nh: 0x5c6bc0, no: 0x7986cb,
  // 酸素
  o: 0xd32f2f, oh: 0xe57373, os: 0xef5350, ow: 0xff8a65,
  // 硫黄
  s: 0xfbc02d, s2: 0xfdd835, s4: 0xffee58, s6: 0xfff176, sh: 0xffe082,
  ss: 0xf9a825, sx: 0xffca28, sy: 0xffd54f,
  // リン
  p2: 0xff7043, p3: 0xff8a65, p4: 0xff8a65, p5: 0xff8a65,
  pb: 0xffab91, pc: 0xffab91, pd: 0xffab91, pe: 0xffab91, pf: 0xffab91,
  px: 0xffab91, py: 0xffab91,
  // ハロゲン
  f: 0xc8e6a0, cl: 0x43a047, br: 0x8d6e63, i: 0x7b1fa2,
};

function hslToHex(h, s, l) {
  s /= 100; l /= 100;
  const k = (n) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  const r = Math.round(255 * f(0)), g = Math.round(255 * f(8)), b = Math.round(255 * f(4));
  return (r << 16) | (g << 8) | b;
}

function hashColor(type) {
  let hash = 0;
  for (let i = 0; i < type.length; i++) hash = type.charCodeAt(i) + ((hash << 5) - hash);
  const hue = Math.abs(hash) % 360;
  return hslToHex(hue, 65, 55);
}

function colorForGaff(gaffType) {
  return GAFF_PALETTE[gaffType] !== undefined ? GAFF_PALETTE[gaffType] : hashColor(gaffType);
}

// --- 電荷モード: 発散カラーマップ + 半径マッピング -------------------------
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

function radiusForCharge(charge, maxAbs) {
  const norm = maxAbs > 0 ? Math.abs(charge) / maxAbs : 0;
  return CHARGE_BASE_RADIUS + CHARGE_RADIUS_SCALE * norm;
}

const GAFF_SPHERE_RADIUS = 0.28;
const STICK_RADIUS = 0.13;

// --- アプリ状態 -------------------------------------------------------------
let viewer = null;
let currentParsed = null;
let mode = 'gaff'; // 'gaff' | 'charge'
let labelsOn = true;
let highlightShape = null;
let activeRowIdx = null;

const el = {
  select: document.getElementById('molecule-select'),
  fileInput: document.getElementById('file-input'),
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

function applyStyle() {
  if (!viewer.getModel()) return;
  const maxAbs = maxAbsCharge(currentParsed.atoms);
  // per-atom mutation of glAtom.color/.style did not refresh the cached WebGL mesh on
  // subsequent renders here, so apply per-atom via setStyle({serial}, ...) instead, which
  // reliably rebuilds the geometry with the explicit color.
  currentParsed.atoms.forEach((p) => {
    const color = mode === 'gaff' ? colorForGaff(p.gaffType) : colorForCharge(p.charge, maxAbs);
    const radius = mode === 'gaff' ? GAFF_SPHERE_RADIUS : radiusForCharge(p.charge, maxAbs);
    viewer.setStyle({ serial: p.id }, {
      stick: { radius: STICK_RADIUS, color },
      sphere: { radius, color },
    });
  });
  viewer.render();
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
    radius: (mode === 'gaff' ? GAFF_SPHERE_RADIUS : radiusForCharge(p.charge, maxAbsCharge(currentParsed.atoms))) + 0.35,
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
  viewer.clear();
  viewer.addModel(text, 'mol2');
  applyStyle();
  applyLabels();
  viewer.zoomTo();
  viewer.render();
  buildTable(currentParsed);
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

function handleFile(file) {
  file.text().then((text) => {
    const name = file.name.replace(/\.mol2$/i, '');
    userTexts[name] = text;
    addOptionIfMissing(name);
    el.select.value = name;
    renderMolecule(text, name);
  });
}

function setMode(newMode) {
  mode = newMode;
  el.modeSeg.querySelectorAll('.segmented-btn').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.mode === mode);
  });
  applyStyle();
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
