// Minimal SYBYL mol2 parser focused on GAFF type + partial charge extraction.
// Returns { name, atoms: [{id, name, x, y, z, gaffType, element, charge}], bonds: [{a, b, order}] }.

const ELEMENT_FROM_GAFF = {
  // Common GAFF atom types -> element symbol (first-letter fallback handles the rest).
  br: 'Br', cl: 'Cl', na: 'Na', li: 'Li', ca: 'C', cl6: 'Cl',
};

function elementFromGaff(gaff, atomName) {
  const g = gaff.toLowerCase();
  if (g.startsWith('cl')) return 'Cl';
  if (g.startsWith('br')) return 'Br';
  if (g.startsWith('c')) return 'C';
  if (g.startsWith('h')) return 'H';
  if (g.startsWith('n')) return 'N';
  if (g.startsWith('o')) return 'O';
  if (g.startsWith('s')) return 'S';
  if (g.startsWith('p')) return 'P';
  if (g.startsWith('f')) return 'F';
  if (g.startsWith('i')) return 'I';
  // Fallback: strip trailing digits from the atom name.
  const m = (atomName || '').match(/^[A-Za-z]{1,2}/);
  return m ? m[0][0].toUpperCase() + (m[0][1] || '').toLowerCase() : 'C';
}

export function parseMol2(text) {
  const lines = text.split(/\r?\n/);
  let section = null;
  let molName = 'molecule';
  let molNameLineNext = false;
  const atoms = [];
  const bonds = [];

  for (const raw of lines) {
    const line = raw.trimEnd();
    if (line.startsWith('@<TRIPOS>')) {
      const tag = line.slice('@<TRIPOS>'.length).trim().toUpperCase();
      section = tag;
      if (tag === 'MOLECULE') molNameLineNext = true;
      continue;
    }
    if (section === 'MOLECULE') {
      if (molNameLineNext && line.trim()) {
        molName = line.trim();
        molNameLineNext = false;
      }
      continue;
    }
    if (section === 'ATOM') {
      const t = line.trim().split(/\s+/);
      if (t.length < 6) continue;
      const gaffType = t[5];
      const name = t[1];
      atoms.push({
        id: parseInt(t[0], 10),
        name,
        x: parseFloat(t[2]),
        y: parseFloat(t[3]),
        z: parseFloat(t[4]),
        gaffType,
        element: elementFromGaff(gaffType, name),
        charge: t.length >= 9 ? parseFloat(t[8]) : (t.length >= 7 ? parseFloat(t[t.length - 1]) : 0),
      });
    } else if (section === 'BOND') {
      const t = line.trim().split(/\s+/);
      if (t.length < 4) continue;
      bonds.push({ a: parseInt(t[1], 10), b: parseInt(t[2], 10), order: t[3] });
    }
  }
  return { name: molName, atoms, bonds };
}
