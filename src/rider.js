// Der Snowboarder nach der Character-Sheet-Vorlage (Low-Poly, detailliert):
//  - Kopf: schwarze Beanie mit Umschlag, braune Haarsträhnen, Gesicht mit
//    Nase/Kinn/Ohren, große Goggles mit dickem Rahmen und blau-violettem Glas
//  - Jacke: weite Schalenjacke, weiß/grau mit Diagonale, dunkle Unterarme,
//    hoher Stehkragen (außen dunkel, innen weiß), Kapuze mit Kordeln,
//    Reißverschluss, Brusttasche, abgesetzter Saum
//  - Hose: weite schwarze Cargohose mit Taschen, Kniepartie, weiter Beinabschluss
//  - Boots: schwarz mit weißer Sohle, weißen Seitenstreifen und Schnürung
//  - Board: schwarz mit weißem Rand, hochgezogene Nose/Tail, Bindungen mit Ratschen
//
// Arme und Beine werden über "inverse Kinematik" gestellt: Wir sagen, wo die
// Füße (auf dem Board) und die Hände hin sollen, und berechnen daraus, wie
// Knie und Ellbogen gebeugt sind.
//
// Koordinaten: Board zeigt nach -Z (vorne), Fahrer schaut nach +X (Zehenseite),
// oben ist +Y. Linker Fuß vorne (Regular-Stance).
import * as THREE from 'three';

const PALETTE = {
  white: 0xe2e3e9,
  light: 0xc4c6cf,
  grey: 0x5f6170,
  dark: 0x33343f,
  black: 0x1b1b20,
  pants: 0x26262d,
  pantsDark: 0x1c1c22,
  blue: 0x2f7bff,
  purple: 0x5a3fc8,
  skin: 0xd9a684,
  skinDark: 0xc08a6a,
  hair: 0x7a4325,
};

function mat(color, extra = {}) {
  return new THREE.MeshStandardMaterial({ color, roughness: 0.82, flatShading: true, ...extra });
}

const NEG_Y = new THREE.Vector3(0, -1, 0);
const _d = new THREE.Vector3();
const _u = new THREE.Vector3();
const _p = new THREE.Vector3();
const _t = new THREE.Vector3();

// Zwei-Knochen-IK: Gelenk-Position (Knie/Ellbogen) aus Start, Ziel und Beugerichtung
function solveIK(a, target, l1, l2, hint, outMid, outEnd) {
  _d.subVectors(target, a);
  let dist = _d.length();
  dist = Math.min(Math.max(dist, Math.abs(l1 - l2) + 0.01), (l1 + l2) * 0.999);
  _u.copy(_d).normalize();
  const x = (l1 * l1 - l2 * l2 + dist * dist) / (2 * dist);
  const h = Math.sqrt(Math.max(0, l1 * l1 - x * x));
  _p.copy(hint).addScaledVector(_u, -hint.dot(_u)).normalize();
  outMid.copy(a).addScaledVector(_u, x).addScaledVector(_p, h);
  outEnd.copy(a).addScaledVector(_u, dist);
}

// Ein Körperteil, das von Punkt a nach Punkt b zeigt (Geometrie hängt entlang -Y).
// Die Drehung um die eigene Achse wird über einen Referenzvektor stabil gehalten.
const _x = new THREE.Vector3();
const _z = new THREE.Vector3();
const _m4 = new THREE.Matrix4();
class Segment {
  constructor(parent, length, twistRef = new THREE.Vector3(1, 0, 0)) {
    this.length = length;
    this.twistRef = twistRef;
    this.g = new THREE.Group();
    parent.add(this.g);
  }
  add(mesh) {
    this.g.add(mesh);
    return mesh;
  }
  point(a, b) {
    this.g.position.copy(a);
    _t.subVectors(a, b).normalize(); // lokale +Y-Achse zeigt von b nach a
    _x.copy(this.twistRef).addScaledVector(_t, -this.twistRef.dot(_t));
    if (_x.lengthSq() < 1e-6) _x.set(0, 0, 1).addScaledVector(_t, -_t.z);
    _x.normalize();
    _z.crossVectors(_x, _t);
    _m4.makeBasis(_x, _t, _z);
    this.g.quaternion.setFromRotationMatrix(_m4);
  }
}

function tube(rStart, rEnd, length, material, sides = 8) {
  const g = new THREE.CylinderGeometry(rStart, rEnd, length, sides);
  g.translate(0, -length / 2, 0);
  return new THREE.Mesh(g, material);
}

function box(w, h, d, material, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
  m.position.set(x, y, z);
  return m;
}

// Jacke: weiter Körper mit diagonaler Zweifarbigkeit (pro Dreieck eingefärbt)
function jacketGeometry() {
  const H = 0.7;
  const g = new THREE.CylinderGeometry(1, 1, H, 12, 7).toNonIndexed();
  const pos = g.attributes.position;
  // Profil (Radius über die Höhe): Saum weit, Brust voll, Schultern abfallend
  const profile = (t) => {
    if (t < 0.12) return 0.228;
    if (t < 0.55) return 0.215 + (t - 0.12) * 0.03;
    if (t < 0.82) return 0.228;
    return 0.228 - (t - 0.82) * 0.55;
  };
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i);
    const t = (y + H / 2) / H;
    const r = profile(t);
    const x = pos.getX(i) * r * 0.7;
    const z = pos.getZ(i) * r;
    // Schultern: oben seitlich etwas tiefer
    const drop = t > 0.85 ? Math.abs(pos.getZ(i)) * 0.06 : 0;
    pos.setXYZ(i, x, y - drop, z);
  }
  g.translate(0, H / 2 - 0.13, 0);
  g.computeVertexNormals();

  const colors = new Float32Array(pos.count * 3);
  const white = new THREE.Color(PALETTE.white);
  const grey = new THREE.Color(PALETTE.grey);
  const dark = new THREE.Color(PALETTE.dark);
  const light = new THREE.Color(PALETTE.light);
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i += 3) {
    const cx = (pos.getX(i) + pos.getX(i + 1) + pos.getX(i + 2)) / 3;
    const cy = (pos.getY(i) + pos.getY(i + 1) + pos.getY(i + 2)) / 3;
    const cz = (pos.getZ(i) + pos.getZ(i + 1) + pos.getZ(i + 2)) / 3;
    if (cy < -0.08) c.copy(dark); // abgesetzter Saum
    else if (cy > 0.5) c.copy(white); // Schulterpasse
    else if (cx >= 0) {
      // Vorderseite: weiße Fläche oben, diagonal abgeschnitten (wie in der Vorlage)
      const d = cy + 0.85 * cz;
      c.copy(d > 0.27 ? white : d > 0.24 ? light : grey);
    } else {
      const d = cy - 0.85 * cz;
      c.copy(d > 0.3 ? white : d > 0.27 ? light : grey);
    }
    // seitliche dunkle Einsätze
    if (cy > -0.08 && cy < 0.42 && Math.abs(cz) > 0.2) c.lerp(dark, 0.55);
    const v = 0.95 + (((i * 7) % 5) * 0.02); // Facetten-Variation
    c.multiplyScalar(v);
    for (let k = 0; k < 3; k++) colors.set([c.r, c.g, c.b], (i + k) * 3);
  }
  g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return g;
}

function boardGeometry(width, length, thickness) {
  const s = new THREE.Shape();
  const hw = width / 2;
  const hl = length / 2;
  const tip = 0.17;
  const waist = 0.014;
  s.moveTo(-hw, -hl + tip);
  s.quadraticCurveTo(-hw + waist, 0, -hw, hl - tip);
  s.quadraticCurveTo(-hw, hl, 0, hl);
  s.quadraticCurveTo(hw, hl, hw, hl - tip);
  s.quadraticCurveTo(hw - waist, 0, hw, -hl + tip);
  s.quadraticCurveTo(hw, -hl, 0, -hl);
  s.quadraticCurveTo(-hw, -hl, -hw, -hl + tip);
  const g = new THREE.ExtrudeGeometry(s, { depth: thickness, bevelEnabled: false, curveSegments: 8 });
  g.rotateX(-Math.PI / 2);
  const pos = g.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const z = pos.getZ(i);
    const k = Math.max(0, Math.abs(z) - (hl - 0.22)) / 0.22;
    pos.setY(i, pos.getY(i) + k * k * 0.085);
  }
  g.computeVertexNormals();
  return g;
}

function lensGeometry() {
  // gewölbtes Glas mit Farbverlauf (oben blau, unten violett)
  const g = new THREE.CylinderGeometry(0.135, 0.135, 0.07, 14, 2, true, -0.85, 1.7);
  g.rotateY(Math.PI / 2); // Wölbung nach +X
  const pos = g.attributes.position;
  const colors = new Float32Array(pos.count * 3);
  const top = new THREE.Color(0x45a6ff);
  const mid = new THREE.Color(0x2f5bff);
  const bot = new THREE.Color(0x6a3cd0);
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const t = (pos.getY(i) + 0.035) / 0.07;
    if (t > 0.5) c.copy(mid).lerp(top, (t - 0.5) * 2);
    else c.copy(bot).lerp(mid, t * 2);
    colors.set([c.r, c.g, c.b], i * 3);
  }
  g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return g;
}

export function buildRider() {
  const root = new THREE.Group();
  const yawG = new THREE.Group();   // Querstellen beim Bremsen
  const flipG = new THREE.Group();  // Saltos (Drehpunkt in Körpermitte)
  const flipInner = new THREE.Group();
  const leanG = new THREE.Group();  // Kurvenlage + Sturz
  root.add(yawG);
  yawG.add(flipG);
  flipG.position.y = 0.85;
  flipG.add(flipInner);
  flipInner.position.y = -0.85;
  flipInner.add(leanG);

  const M = {
    white: mat(PALETTE.white),
    light: mat(PALETTE.light),
    grey: mat(PALETTE.grey),
    dark: mat(PALETTE.dark),
    black: mat(PALETTE.black),
    pants: mat(PALETTE.pants, { roughness: 0.95 }),
    pantsDark: mat(PALETTE.pantsDark, { roughness: 0.95 }),
    skin: mat(PALETTE.skin),
    skinDark: mat(PALETTE.skinDark),
    hair: mat(PALETTE.hair),
    jacket: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8, flatShading: true }),
    lens: new THREE.MeshStandardMaterial({
      vertexColors: true, emissive: 0x2a2a90, emissiveIntensity: 0.35,
      metalness: 0.55, roughness: 0.08, flatShading: true, side: THREE.DoubleSide,
    }),
    sole: mat(0xf2f2f4),
    metal: new THREE.MeshStandardMaterial({ color: 0x9aa0aa, metalness: 0.8, roughness: 0.3, flatShading: true }),
  };
  const dbl = (m) => { const c = m.clone(); c.side = THREE.DoubleSide; return c; };

  // ---------- Board ----------
  const board = new THREE.Group();
  const top = new THREE.Mesh(boardGeometry(0.27, 1.52, 0.018), M.black);
  top.position.y = 0.024;
  const base = new THREE.Mesh(boardGeometry(0.286, 1.555, 0.016), M.sole);
  base.position.y = 0.01;
  board.add(base, top);
  // Board-Grafik: graue Winkel + weißer Schriftzug-Balken
  for (const z of [-0.5, 0.5]) {
    const stripe = box(0.2, 0.004, 0.035, M.grey, 0, 0.044, z);
    stripe.rotation.y = z < 0 ? 0.5 : -0.5;
    board.add(stripe);
  }
  board.add(box(0.06, 0.004, 0.3, M.light, 0, 0.044, 0));
  // Stomp-Pad
  board.add(box(0.1, 0.006, 0.12, M.dark, 0.0, 0.045, 0.0));
  leanG.add(board);

  // ---------- Bindungen + Boots (fest auf dem Board) ----------
  const FEET = [new THREE.Vector3(0, 0.1, -0.26), new THREE.Vector3(0, 0.1, 0.26)];
  for (const f of FEET) {
    const b = new THREE.Group();
    b.position.set(f.x, 0.042, f.z);
    b.rotation.y = f.z < 0 ? 0.25 : -0.12; // Bindungswinkel (Duck-Stance)
    // Bindung
    b.add(box(0.27, 0.02, 0.16, M.black, 0, 0.01, 0));
    const disc = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.012, 10), M.dark);
    disc.position.y = 0.022;
    b.add(disc);
    const highback = box(0.03, 0.24, 0.16, M.black, -0.16, 0.14, 0);
    highback.rotation.z = 0.22;
    b.add(highback);
    for (const s of [-1, 1]) b.add(box(0.2, 0.06, 0.012, M.black, -0.04, 0.05, s * 0.078)); // Seitenwangen
    // Boot
    b.add(box(0.315, 0.045, 0.135, M.sole, 0.02, 0.042, 0));          // Sohle weiß
    b.add(box(0.317, 0.012, 0.137, M.black, 0.02, 0.068, 0));         // Sohlenlinie
    b.add(box(0.29, 0.12, 0.127, M.black, 0.01, 0.125, 0));           // Schaft unten
    b.add(box(0.075, 0.075, 0.13, M.sole, 0.135, 0.1, 0));            // Zehenkappe
    b.add(box(0.06, 0.08, 0.13, M.sole, -0.125, 0.11, 0));            // Fersenkappe
    const sideStripe = box(0.17, 0.028, 0.131, M.sole, -0.01, 0.15, 0);
    sideStripe.rotation.z = -0.35;
    b.add(sideStripe);
    b.add(box(0.17, 0.13, 0.128, M.black, -0.045, 0.24, 0));          // Schaft oben
    b.add(box(0.07, 0.15, 0.08, M.dark, 0.05, 0.22, 0));              // Zunge
    for (let k = 0; k < 3; k++) b.add(box(0.012, 0.008, 0.07, M.light, 0.03 + k * 0.035, 0.19 - k * 0.012, 0)); // Schnürung
    b.add(box(0.15, 0.04, 0.132, M.dark, -0.045, 0.3, 0));            // Polster oben
    // Bindungs-Straps mit Ratschen
    const strap1 = box(0.06, 0.03, 0.16, M.dark, 0.1, 0.17, 0);
    strap1.rotation.z = -0.5;
    const strap2 = box(0.06, 0.035, 0.16, M.dark, -0.03, 0.235, 0);
    strap2.rotation.z = -0.2;
    b.add(strap1, strap2);
    b.add(box(0.03, 0.02, 0.03, M.metal, 0.1, 0.19, -0.075), box(0.03, 0.02, 0.03, M.metal, -0.03, 0.255, -0.075));
    leanG.add(b);
  }

  // ---------- Beine (weite Cargohose) ----------
  const THIGH = 0.46;
  const SHIN = 0.47;
  const legs = [];
  for (const side of [-1, 1]) {
    const thigh = new Segment(leanG, THIGH, new THREE.Vector3(1, 0, 0));
    thigh.add(tube(0.135, 0.12, THIGH, M.pants, 9));
    // Cargotasche mit Klappe und Druckknopf (außen)
    thigh.add(box(0.11, 0.15, 0.05, M.pants, 0, -THIGH * 0.55, side * 0.12));
    thigh.add(box(0.115, 0.035, 0.055, M.pantsDark, 0, -THIGH * 0.55 + 0.075, side * 0.123));
    thigh.add(box(0.015, 0.015, 0.01, M.grey, 0, -THIGH * 0.55 + 0.07, side * 0.152));
    // Gesäß-/Hüftnaht
    thigh.add(tube(0.138, 0.138, 0.025, M.pantsDark, 9)).position.y = -0.02;
    const shin = new Segment(leanG, SHIN, new THREE.Vector3(1, 0, 0));
    shin.add(tube(0.118, 0.142, SHIN, M.pants, 9));
    const knee = shin.add(new THREE.Mesh(new THREE.IcosahedronGeometry(0.122, 1), M.pants));
    knee.scale.set(1, 0.85, 1);
    // Kniepartie (abgesetzt)
    shin.add(box(0.05, 0.12, 0.14, M.pantsDark, 0.11, -0.06, 0));
    // weiter Beinabschluss über dem Boot
    shin.add(tube(0.146, 0.15, 0.06, M.pantsDark, 9)).position.y = -SHIN + 0.1;
    legs.push({ thigh, shin, side, foot: FEET[side < 0 ? 0 : 1] });
  }

  // ---------- Oberkörper ----------
  const torso = new THREE.Group(); // Ursprung = Becken
  leanG.add(torso);
  const hips = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.165, 0.22, 10), M.pants);
  hips.scale.x = 0.75;
  hips.position.y = -0.05;
  torso.add(hips);
  torso.add(new THREE.Mesh(jacketGeometry(), M.jacket));
  // Saumband und Kordelstopper
  const hem = new THREE.Mesh(new THREE.CylinderGeometry(0.232, 0.232, 0.035, 12, 1, true), dbl(M.black));
  hem.scale.x = 0.7;
  hem.position.y = -0.11;
  torso.add(hem);
  // Reißverschluss vorne + Brusttasche
  torso.add(box(0.012, 0.6, 0.018, M.black, 0.158, 0.21, -0.015));
  const pocketZip = box(0.012, 0.1, 0.012, M.black, 0.157, 0.36, 0.08);
  pocketZip.rotation.x = 0.5;
  torso.add(pocketZip);
  torso.add(box(0.01, 0.025, 0.012, M.metal, 0.163, 0.5, -0.015)); // Zipper
  // Ärmelansatz-Nähte
  for (const s of [-1, 1]) {
    const seam = box(0.14, 0.012, 0.02, M.light, 0, 0.46, s * 0.205);
    seam.rotation.x = s * 0.6;
    torso.add(seam);
  }
  // Hoher Stehkragen (außen dunkel, innen weiß)
  const collar = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.14, 0.16, 10, 1, true), dbl(M.dark));
  collar.position.y = 0.6;
  torso.add(collar);
  const collarIn = new THREE.Mesh(new THREE.CylinderGeometry(0.104, 0.13, 0.15, 10, 1, true), M.white.clone());
  collarIn.material.side = THREE.BackSide;
  collarIn.position.y = 0.6;
  torso.add(collarIn);
  // Kragenspitzen vorne (wie in der Vorlage nach außen geklappt)
  for (const s of [-1, 1]) {
    const flap = box(0.02, 0.1, 0.07, M.dark, 0.11, 0.63, s * 0.06);
    flap.rotation.set(s * 0.4, 0, -0.2);
    torso.add(flap);
  }
  // Kapuze mit Kordeln
  const hood = new THREE.Mesh(new THREE.IcosahedronGeometry(0.16, 1), M.dark);
  hood.scale.set(0.65, 0.8, 1.15);
  hood.position.set(-0.14, 0.59, 0);
  torso.add(hood);
  for (const s of [-1, 1]) {
    const cord = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.12, 4), M.light);
    cord.position.set(0.14, 0.5, s * 0.05);
    torso.add(cord);
    torso.add(box(0.018, 0.022, 0.018, M.black, 0.14, 0.435, s * 0.05));
  }

  // ---------- Kopf ----------
  const headTilt = new THREE.Group();
  headTilt.position.set(0.01, 0.63, 0);
  torso.add(headTilt);
  const head = new THREE.Group();
  headTilt.add(head);
  const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.056, 0.1, 7), M.skin);
  neck.position.y = 0.03;
  const skull = new THREE.Mesh(new THREE.IcosahedronGeometry(0.112, 1), M.skin);
  skull.scale.set(1.0, 1.12, 0.94);
  skull.position.y = 0.15;
  // Kinn/Kiefer
  const jaw = new THREE.Mesh(new THREE.IcosahedronGeometry(0.075, 0), M.skin);
  jaw.scale.set(1.05, 0.8, 1.1);
  jaw.position.set(0.04, 0.08, 0);
  const nose = new THREE.Mesh(new THREE.ConeGeometry(0.022, 0.06, 4), M.skinDark);
  nose.rotation.z = -Math.PI / 2;
  nose.position.set(0.12, 0.115, 0);
  const mouth = box(0.01, 0.008, 0.045, M.skinDark, 0.108, 0.075, 0);
  const ears = [-1, 1].map((s) => {
    const e = new THREE.Mesh(new THREE.IcosahedronGeometry(0.025, 0), M.skinDark);
    e.scale.set(0.8, 1.2, 0.5);
    e.position.set(0, 0.12, s * 0.108);
    return e;
  });
  head.add(neck, skull, jaw, nose, mouth, ...ears);
  // Beanie mit Umschlag und Krone
  const beanie = new THREE.Mesh(new THREE.SphereGeometry(0.13, 10, 6, 0, Math.PI * 2, 0, Math.PI * 0.55), M.black);
  beanie.scale.y = 1.22;
  beanie.position.y = 0.18;
  const beanieCuff = new THREE.Mesh(new THREE.CylinderGeometry(0.132, 0.135, 0.07, 10), M.black);
  beanieCuff.position.y = 0.2;
  const cuffLine = new THREE.Mesh(new THREE.CylinderGeometry(0.1335, 0.1335, 0.008, 10, 1, true), dbl(M.dark));
  cuffLine.position.y = 0.235;
  const crown = new THREE.Mesh(new THREE.IcosahedronGeometry(0.05, 0), M.black);
  crown.scale.set(1.2, 0.6, 1.2);
  crown.position.y = 0.32;
  head.add(beanie, beanieCuff, cuffLine, crown);
  // braune Haarsträhnen unter der Mütze (vorne und seitlich)
  const hairSpots = [
    [0.1, 0.205, 0.07, 0.9], [0.1, 0.2, -0.08, -0.9], [0.06, 0.2, 0.115, 1.5],
    [0.06, 0.2, -0.115, -1.5], [-0.04, 0.19, 0.12, 2.1], [-0.04, 0.19, -0.12, -2.1], [0.11, 0.21, 0.0, 0],
  ];
  for (const [x, y, z, r] of hairSpots) {
    const h = new THREE.Mesh(new THREE.ConeGeometry(0.03, 0.085, 4), M.hair);
    h.position.set(x, y, z);
    h.rotation.set(0, r, -Math.PI / 2 - 0.5);
    head.add(h);
  }
  // Goggles: dicker Rahmen, gewölbtes Glas, Band um die Mütze
  const frame = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.14, 0.09, 14, 1, true, -0.95, 1.9), dbl(M.black));
  frame.rotation.y = Math.PI / 2;
  frame.position.set(-0.02, 0.165, 0);
  frame.scale.set(1, 1, 1.05);
  const lens = new THREE.Mesh(lensGeometry(), M.lens);
  lens.position.set(-0.012, 0.165, 0);
  const strap = new THREE.Mesh(new THREE.CylinderGeometry(0.137, 0.137, 0.04, 12, 1, true), dbl(M.dark));
  strap.position.y = 0.165;
  const strapLogo = box(0.03, 0.02, 0.06, M.grey, -0.135, 0.165, 0);
  head.add(frame, lens, strap, strapLogo);

  // ---------- Arme ----------
  const UPPER = 0.3;
  const FORE = 0.28;
  const arms = [];
  for (const side of [-1, 1]) {
    const upper = new Segment(leanG, UPPER, new THREE.Vector3(0, 0, side));
    upper.add(tube(0.082, 0.072, UPPER, M.white, 9));
    const shoulderPad = upper.add(new THREE.Mesh(new THREE.IcosahedronGeometry(0.085, 1), M.white));
    shoulderPad.position.y = -0.02;
    upper.add(tube(0.074, 0.074, 0.03, M.grey, 9)).position.y = -UPPER + 0.03; // Farbwechsel am Ellbogen
    const fore = new Segment(leanG, FORE, new THREE.Vector3(0, 0, side));
    fore.add(tube(0.07, 0.064, FORE, M.dark, 9));
    fore.add(new THREE.Mesh(new THREE.IcosahedronGeometry(0.07, 1), M.dark));
    fore.add(tube(0.075, 0.072, 0.06, M.black, 9)).position.y = -FORE + 0.05; // Bündchen
    // Handschuh: Stulpe, Handrücken, Finger, Daumen, Knöchelpolster
    fore.add(tube(0.072, 0.058, 0.06, M.black, 8)).position.y = -FORE - 0.0;
    fore.add(box(0.075, 0.09, 0.085, M.black, 0, -FORE - 0.085, 0));
    fore.add(box(0.07, 0.06, 0.08, M.black, 0.01, -FORE - 0.155, 0)).rotation.z = 0.3;
    fore.add(box(0.03, 0.06, 0.03, M.black, 0.045, -FORE - 0.07, side * 0.03)).rotation.z = -0.4;
    fore.add(box(0.012, 0.05, 0.07, M.dark, -0.04, -FORE - 0.1, 0));
    arms.push({ upper, fore, side });
  }

  root.traverse((o) => {
    if (o.isMesh) {
      o.castShadow = true;
      o.receiveShadow = true;
    }
  });

  const rider = { root, yawG, flipG, leanG, torso, headTilt, head, legs, arms, THIGH, SHIN, UPPER, FORE };
  rider.hands = [new THREE.Vector3(), new THREE.Vector3()];
  rider.handsInit = false;
  return rider;
}

const _hip = new THREE.Vector3();
const _knee = new THREE.Vector3();
const _ankle = new THREE.Vector3();
const _sh = new THREE.Vector3();
const _elb = new THREE.Vector3();
const _hand = new THREE.Vector3();
const _hint = new THREE.Vector3();
const _target = new THREE.Vector3();
const _pelvis = new THREE.Vector3();
const TMP = [new THREE.Vector3(), new THREE.Vector3()];

// Pose setzen. p = { crouch, grab, tuck, brake, edge, airborne, grind, flip, dt }
export function poseRider(r, p) {
  const c = Math.max(p.crouch, p.flip * 0.8);
  const hipY = 0.98 - 0.42 * c;
  const lean = 0.12 + 0.38 * c + p.tuck * 0.25 - p.brake * 0.15;

  _pelvis.set(0.02 + 0.05 * c - p.brake * 0.06, hipY, 0);
  r.torso.position.copy(_pelvis);
  r.torso.rotation.set(0, 0.3 - p.grab * 0.15, -lean, 'YXZ');
  r.headTilt.rotation.set(0, 0, lean * 0.7);
  r.head.rotation.set(0, 1.0 - p.grab * 0.3, 0);
  r.torso.updateMatrix();

  for (const leg of r.legs) {
    _hip.set(0, -0.06, leg.side * 0.11).applyMatrix4(r.torso.matrix);
    _target.copy(leg.foot).add(_t.set(-0.02, 0.14, 0));
    _hint.set(1, 0, leg.side * 0.35);
    solveIK(_hip, _target, r.THIGH, r.SHIN, _hint, _knee, _ankle);
    leg.thigh.point(_hip, _knee);
    leg.shin.point(_knee, _ankle);
  }

  for (let i = 0; i < 2; i++) {
    const arm = r.arms[i];
    const side = arm.side; // -1 = vorderer (linker) Arm, +1 = hinterer (rechter) Arm
    const T = TMP[i];
    T.set(0.12 + p.edge * 0.15, hipY + 0.12 + Math.abs(p.edge) * 0.15, side * 0.62);
    if (p.tuck > 0) T.lerp(_t.set(0.42, hipY + 0.2, side * 0.12), p.tuck);
    if (p.brake > 0) T.lerp(_t.set(0.05, hipY + 0.45, side * 0.55), p.brake * 0.7);
    if (p.grind > 0) T.lerp(_t.set(0.15, hipY + 0.35, side * 0.6), p.grind);
    if (p.flip > 0) T.lerp(_t.set(0.3, hipY + 0.05, side * 0.12), p.flip); // beim Salto eng am Körper
    if (p.grab > 0) {
      const g = side > 0 ? _t.set(0.15, 0.13, 0.04) : _t.set(0.05, hipY + 0.55, -0.55);
      T.lerp(g, p.grab);
    }
    if (p.airborne > 0 && p.grab === 0 && p.flip === 0) T.y += 0.15 * p.airborne;
    if (!r.handsInit) r.hands[i].copy(T);
    r.hands[i].lerp(T, Math.min(1, (p.dt || 1) * 14));

    _sh.set(0.0, 0.5, side * 0.21).applyMatrix4(r.torso.matrix);
    _hint.set(-0.4, -1, side * 0.3);
    solveIK(_sh, r.hands[i], r.UPPER, r.FORE, _hint, _elb, _hand);
    arm.upper.point(_sh, _elb);
    arm.fore.point(_elb, _hand);
  }
  r.handsInit = true;
}
