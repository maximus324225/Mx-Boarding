// Der Snowboarder nach der Character-Sheet-Vorlage (Low-Poly):
// schwarze Beanie, braune Haare, blau-violette Goggles, zweifarbige Jacke
// (weiß/grau mit Diagonale, dunkle Unterarme, hoher Kragen, Kapuze),
// weite schwarze Cargohose, schwarz-weiße Boots, schwarzes Board mit weißem Rand.
//
// Arme und Beine werden über "inverse Kinematik" gestellt: Wir sagen, wo die
// Füße (auf dem Board) und die Hände hin sollen, und berechnen daraus, wie
// Knie und Ellbogen gebeugt sind. So entstehen Hocke, Grab und Balance-Posen.
//
// Koordinaten: Board zeigt nach -Z (vorne), Fahrer schaut nach +X (Zehenseite),
// oben ist +Y. Linker Fuß vorne (Regular-Stance).
import * as THREE from 'three';

const PALETTE = {
  white: 0xdcdde3,
  grey: 0x5d5f6e,
  dark: 0x2d2e38,
  black: 0x1a1a1f,
  blue: 0x2f6bff,
  purple: 0x5a3fc8,
  skin: 0xd9a684,
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

// Ein Körperteil, das von Punkt a nach Punkt b zeigt (Geometrie hängt entlang -Y)
class Segment {
  constructor(parent, length) {
    this.length = length;
    this.g = new THREE.Group();
    parent.add(this.g);
  }
  add(mesh) {
    this.g.add(mesh);
    return mesh;
  }
  point(a, b) {
    this.g.position.copy(a);
    _t.subVectors(b, a).normalize();
    this.g.quaternion.setFromUnitVectors(NEG_Y, _t);
  }
}

function tube(rStart, rEnd, length, material, sides = 7) {
  const g = new THREE.CylinderGeometry(rStart, rEnd, length, sides);
  g.translate(0, -length / 2, 0);
  return new THREE.Mesh(g, material);
}

// Jacke: Körper mit diagonaler Zweifarbigkeit (pro Dreieck eingefärbt)
function jacketGeometry() {
  const g = new THREE.CylinderGeometry(0.205, 0.215, 0.66, 8, 3).toNonIndexed();
  const pos = g.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    let x = pos.getX(i);
    let z = pos.getZ(i);
    const y = pos.getY(i);
    // Schultern etwas schmaler und abgerundet, Körper flacher (Tiefe)
    const top = Math.max(0, (y - 0.18) / 0.15);
    const s = 1 - top * 0.12;
    x *= 0.68 * s;
    z *= s;
    pos.setXYZ(i, x, y - (top > 0.9 && Math.abs(z) > 0.12 ? 0.04 : 0), z);
  }
  g.translate(0, 0.22, 0);
  g.computeVertexNormals();
  const colors = new Float32Array(pos.count * 3);
  const white = new THREE.Color(PALETTE.white);
  const grey = new THREE.Color(PALETTE.grey);
  const dark = new THREE.Color(PALETTE.dark);
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i += 3) {
    const cx = (pos.getX(i) + pos.getX(i + 1) + pos.getX(i + 2)) / 3;
    const cy = (pos.getY(i) + pos.getY(i + 1) + pos.getY(i + 2)) / 3;
    const cz = (pos.getZ(i) + pos.getZ(i + 1) + pos.getZ(i + 2)) / 3;
    if (cy < -0.06) c.copy(dark); // Bund unten
    else if (cy > 0.52) c.copy(white); // Schultern
    else if (cx >= 0) c.copy(cy + 0.9 * cz > 0.26 ? white : grey); // Vorderseite, Diagonale
    else c.copy(cy - 0.9 * cz > 0.3 ? white : grey); // Rückseite, gespiegelt
    const v = 0.96 + ((i * 7) % 5) * 0.015; // leichte Facetten-Variation
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
  const tip = 0.17; // Länge der Rundung an Nose/Tail
  const waist = 0.012; // Taillierung
  s.moveTo(-hw, -hl + tip);
  s.quadraticCurveTo(-hw + waist, 0, -hw, hl - tip);
  s.quadraticCurveTo(-hw, hl, 0, hl);
  s.quadraticCurveTo(hw, hl, hw, hl - tip);
  s.quadraticCurveTo(hw - waist, 0, hw, -hl + tip);
  s.quadraticCurveTo(hw, -hl, 0, -hl);
  s.quadraticCurveTo(-hw, -hl, -hw, -hl + tip);
  const g = new THREE.ExtrudeGeometry(s, { depth: thickness, bevelEnabled: false, curveSegments: 5 });
  g.rotateX(-Math.PI / 2);
  // Nose und Tail nach oben biegen
  const pos = g.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const z = pos.getZ(i);
    const k = Math.max(0, Math.abs(z) - (hl - 0.2)) / 0.2;
    pos.setY(i, pos.getY(i) + k * k * 0.075);
  }
  g.computeVertexNormals();
  return g;
}

export function buildRider() {
  const root = new THREE.Group();
  const yawG = new THREE.Group();   // Querstellen beim Bremsen
  const leanG = new THREE.Group();  // Kurvenlage + Sturz
  root.add(yawG);
  yawG.add(leanG);

  const M = {
    white: mat(PALETTE.white),
    grey: mat(PALETTE.grey),
    dark: mat(PALETTE.dark),
    black: mat(PALETTE.black),
    pants: mat(0x26262c, { roughness: 0.95 }),
    skin: mat(PALETTE.skin),
    hair: mat(PALETTE.hair),
    jacket: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, flatShading: true }),
    lens: new THREE.MeshStandardMaterial({
      color: PALETTE.blue, emissive: PALETTE.purple, emissiveIntensity: 0.35,
      metalness: 0.4, roughness: 0.12, flatShading: true,
    }),
    sole: mat(0xf2f2f4),
  };

  // ---------- Board ----------
  const board = new THREE.Group();
  const top = new THREE.Mesh(boardGeometry(0.27, 1.52, 0.018), M.black);
  top.position.y = 0.022;
  const base = new THREE.Mesh(boardGeometry(0.285, 1.55, 0.014), M.sole);
  base.position.y = 0.01;
  board.add(base, top);
  // Grafik auf dem Board: zwei graue Streifen
  for (const z of [-0.55, 0.55]) {
    const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.004, 0.05), M.grey);
    stripe.position.set(0, 0.042, z);
    board.add(stripe);
  }
  leanG.add(board);

  // ---------- Bindungen + Boots (fest auf dem Board) ----------
  const FEET = [new THREE.Vector3(0, 0.1, -0.26), new THREE.Vector3(0, 0.1, 0.26)];
  for (const f of FEET) {
    const b = new THREE.Group();
    b.position.set(f.x, 0.04, f.z);
    const plate = new THREE.Mesh(new THREE.BoxGeometry(0.27, 0.02, 0.15), M.black);
    plate.position.y = 0.01;
    const highback = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.22, 0.15), M.black);
    highback.position.set(-0.15, 0.13, 0);
    highback.rotation.z = 0.2;
    const sole = new THREE.Mesh(new THREE.BoxGeometry(0.31, 0.045, 0.13), M.sole);
    sole.position.set(0.02, 0.04, 0);
    const boot = new THREE.Mesh(new THREE.BoxGeometry(0.29, 0.13, 0.125), M.black);
    boot.position.set(0.01, 0.12, 0);
    const toe = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.07, 0.13), M.sole);
    toe.position.set(0.13, 0.09, 0);
    const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.03, 0.13), M.sole);
    stripe.position.set(0.0, 0.15, 0);
    stripe.rotation.z = -0.35;
    const strap1 = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.03, 0.15), M.grey);
    strap1.position.set(0.07, 0.19, 0);
    const strap2 = strap1.clone();
    strap2.position.set(-0.04, 0.22, 0);
    const shaft = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.12, 0.13), M.black);
    shaft.position.set(-0.05, 0.22, 0);
    b.add(plate, highback, sole, boot, toe, stripe, strap1, strap2, shaft);
    leanG.add(b);
  }

  // ---------- Beine (weite Cargohose) ----------
  const THIGH = 0.46;
  const SHIN = 0.47;
  const legs = [];
  for (const side of [-1, 1]) {
    const thigh = new Segment(leanG, THIGH);
    thigh.add(tube(0.13, 0.115, THIGH, M.pants));
    const pocket = thigh.add(new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.13, 0.11), M.pants));
    pocket.position.set(0, -THIGH * 0.55, side * 0.115);
    const flap = thigh.add(new THREE.Mesh(new THREE.BoxGeometry(0.065, 0.025, 0.115), M.black));
    flap.position.set(0, -THIGH * 0.55 + 0.07, side * 0.118);
    const shin = new Segment(leanG, SHIN);
    shin.add(tube(0.112, 0.135, SHIN, M.pants));
    const knee = shin.add(new THREE.Mesh(new THREE.IcosahedronGeometry(0.115, 0), M.pants));
    knee.position.y = 0;
    const cuff = shin.add(tube(0.138, 0.14, 0.05, M.black));
    cuff.position.y = -SHIN + 0.08;
    legs.push({ thigh, shin, side, foot: FEET[side < 0 ? 0 : 1] });
  }

  // ---------- Oberkörper ----------
  const torso = new THREE.Group(); // Ursprung = Becken
  leanG.add(torso);
  const hips = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.16, 0.2, 8), M.pants);
  hips.scale.x = 0.75;
  hips.position.y = -0.03;
  torso.add(hips);
  const jacket = new THREE.Mesh(jacketGeometry(), M.jacket);
  torso.add(jacket);
  // Hoher Kragen (außen dunkel, innen weiß) und Kapuze
  const collar = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.13, 0.11, 8, 1, true), M.dark);
  collar.material = M.dark.clone();
  collar.material.side = THREE.DoubleSide;
  collar.position.y = 0.58;
  torso.add(collar);
  const collarIn = new THREE.Mesh(new THREE.CylinderGeometry(0.095, 0.12, 0.1, 8, 1, true), M.white.clone());
  collarIn.material.side = THREE.BackSide;
  collarIn.position.y = 0.585;
  torso.add(collarIn);
  const hood = new THREE.Mesh(new THREE.IcosahedronGeometry(0.15, 0), M.dark);
  hood.scale.set(0.7, 0.75, 1.15);
  hood.position.set(-0.13, 0.58, 0);
  torso.add(hood);

  // ---------- Kopf ----------
  const headTilt = new THREE.Group();
  headTilt.position.set(0.01, 0.62, 0);
  torso.add(headTilt);
  const head = new THREE.Group();
  headTilt.add(head);
  const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.055, 0.1, 6), M.skin);
  neck.position.y = 0.03;
  const skull = new THREE.Mesh(new THREE.IcosahedronGeometry(0.112, 1), M.skin);
  skull.scale.set(1.02, 1.12, 0.95);
  skull.position.y = 0.15;
  const nose = new THREE.Mesh(new THREE.ConeGeometry(0.02, 0.05, 4), M.skin);
  nose.rotation.z = -Math.PI / 2;
  nose.position.set(0.12, 0.12, 0);
  const beanie = new THREE.Mesh(new THREE.SphereGeometry(0.128, 8, 5, 0, Math.PI * 2, 0, Math.PI * 0.55), M.black);
  beanie.scale.y = 1.15;
  beanie.position.y = 0.175;
  const beanieCuff = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.133, 0.065, 8), M.black);
  beanieCuff.position.y = 0.19;
  head.add(neck, skull, nose, beanie, beanieCuff);
  // braune Haarsträhnen unter der Mütze
  const hairSpots = [[0.08, 0.17, 0.09, 0.8], [0.08, 0.17, -0.09, -0.8], [0.03, 0.15, 0.12, 1.4], [0.03, 0.15, -0.12, -1.4], [-0.05, 0.15, 0.11, 2.0]];
  for (const [x, y, z, r] of hairSpots) {
    const h = new THREE.Mesh(new THREE.ConeGeometry(0.03, 0.08, 4), M.hair);
    h.position.set(x, y, z);
    h.rotation.set(r * 0.4, 0, Math.PI / 2 + 0.6);
    h.rotation.y = r;
    head.add(h);
  }
  // Goggles
  const frame = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.08, 0.215), M.black);
  frame.position.set(0.1, 0.16, 0);
  const lens = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.064, 0.2), M.lens);
  lens.position.set(0.126, 0.16, 0);
  const strap = new THREE.Mesh(new THREE.CylinderGeometry(0.132, 0.132, 0.035, 10, 1, true), M.black);
  strap.position.y = 0.16;
  strap.material = M.black.clone();
  strap.material.side = THREE.DoubleSide;
  head.add(frame, lens, strap);

  // ---------- Arme ----------
  const UPPER = 0.3;
  const FORE = 0.28;
  const arms = [];
  for (const side of [-1, 1]) {
    const upper = new Segment(leanG, UPPER);
    upper.add(tube(0.075, 0.068, UPPER, M.white));
    const shoulderPad = upper.add(new THREE.Mesh(new THREE.IcosahedronGeometry(0.08, 0), M.white));
    shoulderPad.position.y = -0.02;
    const fore = new Segment(leanG, FORE);
    fore.add(tube(0.066, 0.06, FORE, M.dark));
    const elbow = fore.add(new THREE.Mesh(new THREE.IcosahedronGeometry(0.066, 0), M.dark));
    elbow.position.y = 0;
    const cuff = fore.add(tube(0.065, 0.065, 0.05, M.black));
    cuff.position.y = -FORE + 0.04;
    const glove = fore.add(new THREE.Mesh(new THREE.BoxGeometry(0.085, 0.12, 0.07), M.black));
    glove.position.y = -FORE - 0.05;
    const thumb = fore.add(new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.06, 0.03), M.black));
    thumb.position.set(0.045, -FORE - 0.02, 0);
    arms.push({ upper, fore, side });
  }

  root.traverse((o) => {
    if (o.isMesh) {
      o.castShadow = true;
      o.receiveShadow = true;
    }
  });

  const rider = { root, yawG, leanG, torso, headTilt, head, legs, arms, THIGH, SHIN, UPPER, FORE };
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

// Pose setzen. p = { crouch, grab, tuck, brake, edge, airborne, grind, dt }
export function poseRider(r, p) {
  const c = p.crouch;
  const hipY = 0.98 - 0.42 * c;
  const lean = 0.12 + 0.38 * c + p.tuck * 0.25 - p.brake * 0.15;

  // Becken + Oberkörper
  _pelvis.set(0.02 + 0.05 * c - p.brake * 0.06, hipY, 0);
  r.torso.position.copy(_pelvis);
  r.torso.rotation.set(0, 0.3 - p.grab * 0.15, -lean, 'YXZ');
  // Kopf bleibt aufrecht und schaut in Fahrtrichtung (-Z)
  r.headTilt.rotation.set(0, 0, lean * 0.7);
  r.head.rotation.set(0, 1.0 - p.grab * 0.3, 0);
  r.torso.updateMatrix();

  // Beine: Hüftgelenk -> Fuß auf dem Board
  for (const leg of r.legs) {
    _hip.set(0, -0.06, leg.side * 0.11).applyMatrix4(r.torso.matrix);
    _target.copy(leg.foot).add(_t.set(-0.02, 0.12, 0));
    _hint.set(1, 0, leg.side * 0.35);
    solveIK(_hip, _target, r.THIGH, r.SHIN, _hint, _knee, _ankle);
    leg.thigh.point(_hip, _knee);
    leg.shin.point(_knee, _ankle);
  }

  // Hand-Ziele je nach Situation
  for (let i = 0; i < 2; i++) {
    const arm = r.arms[i];
    const side = arm.side; // -1 = vorderer (linker) Arm, +1 = hinterer (rechter) Arm
    const T = TMP[i];
    // Balance-Pose: Arme seitlich entlang des Boards
    T.set(0.12 + p.edge * 0.15, hipY + 0.12 + Math.abs(p.edge) * 0.15, side * 0.62);
    if (p.tuck > 0) T.lerp(_t.set(0.42, hipY + 0.2, side * 0.12), p.tuck);
    if (p.brake > 0) T.lerp(_t.set(0.05, hipY + 0.45, side * 0.55), p.brake * 0.7);
    if (p.grind > 0) T.lerp(_t.set(0.15, hipY + 0.35, side * 0.6), p.grind);
    if (p.grab > 0) {
      // hintere Hand greift die Zehenkante (Indy), vordere Hand zur Balance hoch
      const g = side > 0 ? _t.set(0.15, 0.12, 0.04) : _t.set(0.05, hipY + 0.55, -0.55);
      T.lerp(g, p.grab);
    }
    if (p.airborne > 0 && p.grab === 0) T.y += 0.15 * p.airborne;
    // weich nachführen
    if (!r.handsInit) r.hands[i].copy(T);
    r.hands[i].lerp(T, Math.min(1, (p.dt || 1) * 14));

    _sh.set(0.0, 0.5, side * 0.2).applyMatrix4(r.torso.matrix);
    _hint.set(-0.4, -1, side * 0.3);
    solveIK(_sh, r.hands[i], r.UPPER, r.FORE, _hint, _elb, _hand);
    arm.upper.point(_sh, _elb);
    arm.fore.point(_elb, _hand);
  }
  r.handsInit = true;
}
