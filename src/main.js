// MX Boarding – Hauptprogramm.
// Baut die Szene auf (Licht, Himmel, Berge, Nachbearbeitung), verwaltet
// Startbildschirm, Spielmodi, Punkte und die Spielschleife.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { World, setViewChunks } from './world.js';
import { Player } from './player.js';
import { Input } from './input.js';
import { ChaseCamera } from './camera.js';
import { Effects } from './effects.js';
import { AudioEngine } from './audio.js';
import { AutoPilot, CinemaCam } from './attract.js';
import {
  pisteCenter, pisteHeading, heightAt, featuresNear, slotFeatures, railLine,
  setCourse, gateAt, GATE_COUNT, FINISH_Z,
} from './terrain.js';
import { createMountains } from './mountains.js';
import { createSky, SKY } from './sky.js';
import './style.css';

const mobile = window.matchMedia('(pointer: coarse)').matches;
document.body.classList.toggle('mobile', mobile);

function loadPref(key, fallback) {
  try { return localStorage.getItem(key) ?? fallback; } catch { return fallback; }
}
function savePref(key, value) {
  try { localStorage.setItem(key, String(value)); } catch { /* egal */ }
}

// Ist das Spiel beim letzten Start abgestürzt (z. B. weil das Handy den
// Grafikspeicher abgeschaltet hat)? Dann automatisch sparsamer starten.
const crashedLastTime = loadPref('mx-booting', '0') === '1';
savePref('mx-booting', '1');
window.addEventListener('pagehide', () => savePref('mx-booting', '0'));
setTimeout(() => savePref('mx-booting', '0'), 10000);

// ---------- Renderer & Szene ----------
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
document.getElementById('app').appendChild(renderer.domElement);
renderer.domElement.addEventListener('webglcontextlost', (e) => {
  e.preventDefault();
  const order = ['high', 'medium', 'low', 'minimal'];
  const cur = loadPref('mx-quality', 'medium');
  const next = order[Math.min(order.length - 1, order.indexOf(cur) + 1)] || 'minimal';
  savePref('mx-quality', next);
  window.__mxReady = false;
  if (window.__mxFatal) {
    window.__mxFatal('Grafikspeicher voll', 'Das Gerät hat die 3D-Grafik abgeschaltet. Beim Neuladen startet das Spiel mit sparsamerer Grafik.');
  }
});

const scene = new THREE.Scene();
const FOG_COLOR = SKY.horizon.clone();
scene.fog = new THREE.Fog(FOG_COLOR, 170, 760);
scene.background = FOG_COLOR;

const camera = new THREE.PerspectiveCamera(62, window.innerWidth / window.innerHeight, 0.1, 14000);

// Sonne von rechts oben: beleuchtet Gesicht und Jacke des Fahrers
const sun = new THREE.Vector3().setFromSphericalCoords(1, THREE.MathUtils.degToRad(50), THREE.MathUtils.degToRad(80));
const sky = createSky(sun);
scene.add(sky);

// Umgebungslicht + Spiegelungen aus dem Himmel (Goggles, Rails, Board glänzen echt)
const pmrem = new THREE.PMREMGenerator(renderer);
const envScene = new THREE.Scene();
envScene.add(createSky(sun));
const groundGlow = new THREE.Mesh(
  new THREE.CircleGeometry(900, 32),
  new THREE.MeshBasicMaterial({ color: 0xe8eef8, side: THREE.DoubleSide }),
);
groundGlow.rotation.x = -Math.PI / 2;
groundGlow.position.y = -40;
envScene.add(groundGlow);
const envTexture = pmrem.fromScene(envScene, 0.03).texture;
scene.environment = envTexture;
scene.environmentIntensity = 0.6;

const mountains = createMountains(FOG_COLOR);
scene.add(mountains);

const hemi = new THREE.HemisphereLight(0xbcd8ff, 0x8a96a8, 0.55);
scene.add(hemi);
const sunLight = new THREE.DirectionalLight(0xfff3e2, 3.0);
sunLight.castShadow = true;
const sc = sunLight.shadow.camera;
sc.left = -28; sc.right = 28; sc.top = 28; sc.bottom = -28; sc.near = 1; sc.far = 200;
sunLight.shadow.bias = -0.0004;
sunLight.shadow.normalBias = 0.035;
sunLight.shadow.radius = 2.5;
scene.add(sunLight, sunLight.target);

// ---------- Grafikstufen ----------
const QUALITY = {
  high: { label: 'Hoch', pr: 2, shadow: 4096, post: true, view: 6, fog: 760 },
  medium: { label: 'Mittel', pr: 1.5, shadow: 2048, post: false, view: 5, fog: 640 },
  low: { label: 'Niedrig', pr: 1, shadow: 1024, post: false, view: 4, fog: 520 },
  minimal: { label: 'Minimal', pr: 1, shadow: 0, post: false, view: 3, fog: 420, noEnv: true },
};
const QUALITY_ORDER = ['high', 'medium', 'low', 'minimal'];
let quality = loadPref('mx-quality', mobile ? 'medium' : 'high');
if (!QUALITY[quality]) quality = mobile ? 'medium' : 'high';
let qualityLowered = false;
if (crashedLastTime && quality !== 'minimal') {
  quality = QUALITY_ORDER[QUALITY_ORDER.indexOf(quality) + 1];
  savePref('mx-quality', quality);
  qualityLowered = true;
}
let composer = null;
let bloom = null;

function createComposer() {
  const size = renderer.getDrawingBufferSize(new THREE.Vector2());
  const rt = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples: 4 });
  composer = new EffectComposer(renderer, rt);
  composer.addPass(new RenderPass(scene, camera));
  // dezentes Leuchten nur für sehr helle Stellen (Sonne, Glitzern, Fenster)
  bloom = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 0.18, 0.35, 3.2);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());
}

function applyQuality() {
  const q = QUALITY[quality];
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, q.pr));
  renderer.setSize(window.innerWidth, window.innerHeight);
  sunLight.castShadow = q.shadow > 0;
  if (q.shadow > 0) sunLight.shadow.mapSize.set(q.shadow, q.shadow);
  scene.environment = q.noEnv ? null : envTexture;
  hemi.intensity = q.noEnv ? 1.1 : 0.55;
  setViewChunks(q.view);
  scene.fog.far = q.fog;
  scene.fog.near = q.fog * 0.22;
  if (sunLight.shadow.map) {
    sunLight.shadow.map.dispose();
    sunLight.shadow.map = null;
  }
  if (q.post && !composer) createComposer();
  if (composer) {
    composer.setPixelRatio(renderer.getPixelRatio());
    composer.setSize(window.innerWidth, window.innerHeight);
  }
  document.getElementById('btn-quality').textContent = `Grafik: ${q.label}`;
}

// ---------- Spielobjekte ----------
const world = new World(scene, mobile);
const player = new Player(scene);
const input = new Input();
const chase = new ChaseCamera(camera);
const fx = new Effects(scene, mobile);
const audio = new AudioEngine();
const pilot = new AutoPilot();
const cine = new CinemaCam(camera, chase);
applyQuality();

// ---------- Spielmodi ----------
const MODES = [
  {
    id: 'freeride', name: 'Freeride', park: true, lives: 3,
    desc: 'Endlos durch den Snowpark den Berg hinunter. 3 Leben, Punkte für Meter und Tricks.',
  },
  {
    id: 'tricks', name: 'Trick-Attack', park: true, time: 120,
    desc: '2 Minuten im Snowpark: Hol so viele Trick-Punkte wie möglich. Stürze kosten nur Zeit.',
  },
  {
    id: 'slalom', name: 'Slalom', park: false, slalom: true,
    desc: `${GATE_COUNT} Tore bis ins Ziel. Jedes verpasste Tor kostet 3 Strafsekunden.`,
  },
  {
    id: 'chill', name: 'Freies Fahren', park: true,
    desc: 'Ohne Leben und ohne Zeitdruck. Einfach fahren und Tricks üben.',
  },
];
let modeIdx = Math.max(0, MODES.findIndex((m) => m.id === loadPref('mx-mode', 'freeride')));
const mode = () => MODES[modeIdx];

function bestOf(id) {
  return Number(loadPref(`mx-best-${id}`, 0)) || 0;
}

const fmtTime = (t) => {
  const m = Math.floor(t / 60);
  const s = t - m * 60;
  return `${m}:${s < 10 ? '0' : ''}${s.toFixed(2)}`;
};
const fmtClock = (t) => {
  const c = Math.max(0, Math.ceil(t));
  return `${Math.floor(c / 60)}:${String(c % 60).padStart(2, '0')}`;
};
function bestText(m) {
  const b = bestOf(m.id);
  if (m.id === 'chill') return 'Kein Rekord, nur Spaß';
  if (!b) return 'Noch kein Rekord';
  return m.slalom ? `Rekord ${fmtTime(b)}` : `Rekord ${b} Punkte`;
}

// ---------- Oberfläche ----------
const $ = (id) => document.getElementById(id);
const ui = {
  speed: $('speed'), score: $('score'), scoreUnit: $('score-unit'), scoreBox: $('score-box'),
  lives: $('lives'), best: $('best'), bestLine: $('best-line'),
  timer: $('timer'), subinfo: $('subinfo'), countdown: $('countdown'),
  popup: $('popup'), start: $('start'), pause: $('pause'), over: $('gameover'), help: $('help'),
  overMode: $('over-mode'), overTitle: $('over-title'), overScore: $('over-score'), overUnit: $('over-unit'),
  overDetail: $('over-detail'), overBest: $('over-best'), overNew: $('over-new'),
  hud: $('hud'), touch: $('touch'), modes: $('modes'), soundHint: $('sound-hint'),
};

function renderModes() {
  ui.modes.innerHTML = '';
  MODES.forEach((m, i) => {
    const b = document.createElement('button');
    b.className = 'mode' + (i === modeIdx ? ' selected' : '');
    b.setAttribute('role', 'radio');
    b.setAttribute('aria-checked', i === modeIdx ? 'true' : 'false');
    b.innerHTML = `<span class="m-name">${m.name}</span><span class="m-desc">${m.desc}</span><span class="m-best">${bestText(m)}</span>`;
    b.addEventListener('click', () => {
      if (modeIdx === i) return;
      modeIdx = i;
      savePref('mx-mode', m.id);
      audio.click();
      renderModes();
    });
    b.addEventListener('dblclick', () => startGame());
    ui.modes.appendChild(b);
  });
}

let state = 'menu'; // menu | countdown | playing | paused | over
let lives = 3;
let trickPoints = 0;
let startZ = 0;
let minZ = 0;
let runTime = 0;
let penalty = 0;
let gateIdx = 0;
let gatesPassed = 0;
let countdownT = 0;
let popupTimer = 0;
let userCamMode = 0;

function distanceScore() {
  return Math.floor(startZ - minZ) + trickPoints;
}

function showPopup(text, big = false, time = 1.8) {
  ui.popup.innerHTML = text;
  ui.popup.classList.toggle('big', big);
  ui.popup.classList.remove('show');
  void ui.popup.offsetWidth;
  ui.popup.classList.add('show');
  popupTimer = time;
}

function renderLives() {
  ui.lives.textContent = mode().lives ? '●'.repeat(lives) + '○'.repeat(Math.max(0, mode().lives - lives)) : '';
}

function isFree(x, z) {
  for (const list of world.obstaclesNear(z)) {
    for (const o of list) {
      if (Math.abs(o.x - x) < 4 + o.r && o.z < z + 3 && o.z > z - 25) return false;
    }
  }
  return true;
}

// Neustart auf der Piste – an einer Stelle ohne Hindernis direkt voraus
function respawnAt(z) {
  let x = pisteCenter(z);
  for (const off of [0, -8, 8, -16, 16, -22, 22]) {
    if (isFree(pisteCenter(z) + off, z)) { x = pisteCenter(z) + off; break; }
  }
  player.reset(x, z, pisteHeading(z));
  player.ghost = 1.5;
  fx.trail.broken = true;
}

function setState(s) {
  state = s;
  ui.start.classList.toggle('hidden', s !== 'menu');
  ui.pause.classList.toggle('hidden', s !== 'paused');
  ui.over.classList.toggle('hidden', s !== 'over');
  ui.hud.classList.toggle('hidden', s === 'menu');
  ui.touch.classList.toggle('hidden', s !== 'playing');
  ui.countdown.classList.toggle('hidden', s !== 'countdown');
  if (s !== 'menu') ui.help.classList.add('hidden');
  audio.active = s === 'playing';
  if (s === 'paused' && audio.ctx) audio.silenceLoops();
}

// ---------- Startbildschirm mit Show-Fahrt ----------
function enterMenu() {
  setCourse({ park: true, slalom: false });
  world.reset();
  fx.trail.reset();
  const z = -20;
  world.prepare(z);
  respawnAt(z);
  player.ghost = 0;
  pilot.reset();
  cine.reset(player);
  renderModes();
  setState('menu');
  audio.music.setLevel(1);
  audio.music.start();
}

// ---------- Spielstart ----------
function startGame() {
  const m = mode();
  audio.unlock();
  audio.click();
  setCourse({ park: m.park, slalom: !!m.slalom });
  world.reset();
  fx.trail.reset();
  lives = m.lives || 0;
  trickPoints = 0;
  startZ = 0;
  minZ = 0;
  runTime = 0;
  penalty = 0;
  gateIdx = 0;
  gatesPassed = 0;
  world.prepare(0);
  respawnAt(0);
  chase.mode = userCamMode;
  chase.snap(player);
  renderLives();

  ui.timer.classList.toggle('hidden', !(m.time || m.slalom));
  ui.timer.classList.remove('warn');
  ui.subinfo.classList.toggle('hidden', !m.slalom);
  ui.scoreBox.classList.toggle('hidden', !!m.slalom);
  ui.bestLine.classList.toggle('hidden', m.id === 'chill');
  ui.best.textContent = m.slalom ? (bestOf(m.id) ? fmtTime(bestOf(m.id)) : '–') : bestOf(m.id);
  ui.scoreUnit.textContent = m.id === 'tricks' ? 'Trick-Punkte' : 'Punkte';
  updateHud();

  audio.music.setLevel(0.4);
  if (m.time || m.slalom) {
    countdownT = 3;
    ui.countdown.textContent = '3';
    setState('countdown');
    audio.beep(false);
  } else {
    setState('playing');
  }
}

function finishRun(reason) {
  const m = mode();
  let value;
  let better;
  const old = bestOf(m.id);
  ui.overMode.textContent = m.name;
  if (m.slalom) {
    value = runTime + penalty;
    better = reason === 'finish' && (!old || value < old);
    ui.overTitle.textContent = 'Im Ziel!';
    ui.overScore.textContent = fmtTime(value);
    ui.overUnit.textContent = '';
    ui.overDetail.textContent = `${gatesPassed} von ${GATE_COUNT} Toren · Strafzeit ${penalty} s`;
    if (better) savePref(`mx-best-${m.id}`, value.toFixed(2));
    ui.overBest.textContent = bestOf(m.id) ? fmtTime(bestOf(m.id)) : '–';
  } else {
    value = m.id === 'tricks' ? trickPoints : distanceScore();
    better = m.id !== 'chill' && value > old;
    ui.overTitle.textContent = m.id === 'tricks' ? 'Zeit abgelaufen!' : 'Lauf beendet';
    ui.overScore.textContent = value;
    ui.overUnit.textContent = 'Punkte';
    ui.overDetail.textContent = m.id === 'tricks'
      ? `${Math.floor(startZ - minZ)} m gefahren`
      : `${Math.floor(startZ - minZ)} m · ${trickPoints} Trick-Punkte`;
    if (better) savePref(`mx-best-${m.id}`, value);
    ui.overBest.textContent = bestOf(m.id);
  }
  ui.overNew.classList.toggle('hidden', !better);
  if (better) audio.chime(2);
  setState('over');
  audio.music.setLevel(0.8);
}

// ---------- Knöpfe ----------
$('btn-start').addEventListener('click', startGame);
$('btn-restart').addEventListener('click', startGame);
$('btn-restart-pause').addEventListener('click', startGame);
$('btn-menu-pause').addEventListener('click', () => { audio.click(); enterMenu(); });
$('btn-menu-over').addEventListener('click', () => { audio.click(); enterMenu(); });
$('btn-resume').addEventListener('click', () => { audio.click(); setState('playing'); });
$('btn-pause').addEventListener('click', () => setState('paused'));
$('btn-help').addEventListener('click', () => { audio.click(); ui.help.classList.remove('hidden'); });
$('btn-help-close').addEventListener('click', () => { audio.click(); ui.help.classList.add('hidden'); });
$('btn-quality').addEventListener('click', () => {
  quality = QUALITY_ORDER[(QUALITY_ORDER.indexOf(quality) + 1) % QUALITY_ORDER.length];
  savePref('mx-quality', quality);
  applyQuality();
  audio.click();
});

const musicBtn = $('btn-music');
const musicHudBtn = $('btn-music-hud');
function renderMusicButtons() {
  musicBtn.textContent = `🎵 Musik: ${audio.music.enabled ? 'An' : 'Aus'}`;
  musicHudBtn.classList.toggle('off', !audio.music.enabled);
}
function toggleMusic() {
  audio.unlock();
  audio.music.setEnabled(!audio.music.enabled);
  renderMusicButtons();
}
musicBtn.addEventListener('click', toggleMusic);
musicHudBtn.addEventListener('click', toggleMusic);
renderMusicButtons();

const muteBtn = $('btn-mute');
muteBtn.addEventListener('click', () => {
  audio.setSfxMuted(!audio.sfxMuted);
  muteBtn.textContent = audio.sfxMuted ? '🔇' : '🔊';
});

input.onPause = () => {
  if (state === 'playing') setState('paused');
  else if (state === 'paused') setState('playing');
};
function cycleCamera() {
  if (state !== 'playing' && state !== 'countdown') return;
  showPopup(chase.nextMode(), false, 1.2);
  userCamMode = chase.mode;
}
input.onCamera = cycleCamera;
$('btn-cam').addEventListener('click', cycleCamera);

window.addEventListener('keydown', (e) => {
  if (e.code === 'KeyM' && !e.repeat) toggleMusic();
  if (state === 'menu' && ui.help.classList.contains('hidden')) {
    if (e.code === 'Enter' || e.code === 'Space') { e.preventDefault(); startGame(); }
    if (e.code === 'ArrowRight' || e.code === 'ArrowLeft') {
      modeIdx = (modeIdx + (e.code === 'ArrowRight' ? 1 : MODES.length - 1)) % MODES.length;
      savePref('mx-mode', mode().id);
      audio.click();
      renderModes();
    }
  } else if (state === 'over' && (e.code === 'Enter' || e.code === 'Space')) {
    e.preventDefault();
    startGame();
  }
});

// Ton freischalten, sobald der Spieler irgendetwas tut
function unlockAudio() {
  audio.unlock();
  if (state === 'menu') audio.music.start();
  ui.soundHint.classList.add('hidden');
}
window.addEventListener('pointerdown', unlockAudio);
window.addEventListener('touchend', unlockAudio);
window.addEventListener('click', unlockAudio);
window.addEventListener('keydown', unlockAudio);

document.addEventListener('visibilitychange', () => {
  if (document.hidden && state === 'playing') setState('paused');
});

const tiltBtn = $('btn-tilt');
tiltBtn.addEventListener('click', async () => {
  if (input.tiltEnabled) {
    input.disableTilt();
  } else if (!(await input.enableTilt())) {
    showPopup('Neigungssensor nicht verfügbar');
  } else {
    showPopup('Neigen zum Lenken<br><small>Handy jetzt gerade halten</small>');
  }
  tiltBtn.classList.toggle('active', input.tiltEnabled);
  document.body.classList.toggle('tilt', input.tiltEnabled);
});

// Handy: Buttons zeigen in der Luft ihre Trick-Funktion
const brakeBtn = document.querySelector('[data-act="brake"]');
const tuckBtn = document.querySelector('[data-act="tuck"]');
let lastAir = null;
function updateTouchLabels() {
  const air = player.state === 'air';
  if (air === lastAir) return;
  lastAir = air;
  brakeBtn.textContent = air ? 'Salto' : 'Bremsen';
  tuckBtn.textContent = air ? 'Grab' : 'Hocke';
}

// ---------- Spiel-Ereignisse ----------
function handleEvents() {
  let respawned = false;
  const m = mode();
  for (const ev of player.events) {
    if (ev.type === 'land') {
      fx.burst(player.pos, 20 + Math.min(40, ev.impact * 4), 2 + ev.impact * 0.2);
      audio.land(ev.impact);
      let pts = 0;
      const parts = [];
      if (ev.airTime > 0.6) {
        pts += Math.round(ev.airTime * 60);
        parts.push(`Airtime ${ev.airTime.toFixed(1)} s`);
      }
      if (ev.flips > 0) {
        const name = ev.flipDir > 0 ? 'Frontflip' : 'Backflip';
        const prefix = ev.flips === 2 ? 'Double ' : ev.flips === 3 ? 'Triple ' : ev.flips > 3 ? `${ev.flips}x ` : '';
        pts += 400 * ev.flips;
        parts.unshift(`<b>${prefix}${name}</b>`);
      }
      if (ev.spin >= 180) {
        pts += ev.spin * 1.5;
        if (ev.flips > 0) parts[0] = parts[0].replace('</b>', ` ${ev.spin}</b>`);
        else parts.unshift(`<b>${ev.spin}°</b>`);
      }
      if (ev.grab && ev.airTime > 0.5) {
        pts += 100;
        parts.push('Grab');
      }
      if (pts > 0) {
        if (ev.clean) { pts = Math.round(pts * 1.25); parts.push('saubere Landung'); }
        trickPoints += pts;
        const bigTrick = ev.spin >= 360 || ev.flips > 0;
        if (m.slalom) pts = 0;
        if (pts > 0) {
          showPopup(`${parts.join(' · ')}<br><span class="pts">+${pts}</span>`, bigTrick);
          audio.chime(bigTrick ? 2 : 1);
        }
      }
    } else if (ev.type === 'grindStart') {
      audio.grindStart(player.grindKind && player.grindKind.includes('Box'));
    } else if (ev.type === 'grind') {
      if (ev.time > 0.25) {
        const pts = Math.round(50 + ev.time * 250);
        trickPoints += pts;
        showPopup(`<b>${ev.kind}</b> · ${ev.time.toFixed(1)} s<br><span class="pts">+${pts}</span>`);
        audio.chime(1);
      }
    } else if (ev.type === 'jump') {
      audio.jump(1);
    } else if (ev.type === 'crash') {
      fx.burst(player.pos, 60, 4);
      audio.crash();
      const msg = {
        obstacle: 'Autsch! Hindernis getroffen', landing: 'Verkantet bei der Landung!',
        impact: 'Zu harte Landung!', flip: 'Salto nicht ganz geschafft!',
      }[ev.reason];
      if (m.lives) {
        lives -= 1;
        renderLives();
        showPopup(lives > 0 ? msg : `${msg}<br>Keine Leben mehr`);
      } else {
        showPopup(msg);
      }
    } else if (ev.type === 'respawn' && !respawned) {
      respawned = true;
      if (m.lives && lives <= 0) finishRun('lives');
      else respawnAt(player.pos.z - 2);
    }
  }
  player.events.length = 0;
}

function checkGates() {
  while (gateIdx < GATE_COUNT && player.pos.z < gateAt(gateIdx).z) {
    const g = gateAt(gateIdx);
    const ok = Math.abs(player.pos.x - g.x) < g.half + 0.3;
    if (ok) {
      gatesPassed++;
      audio.gate(true);
    } else {
      penalty += 3;
      audio.gate(false);
      showPopup('Tor verpasst!<br><span class="pts">+3 s</span>', false, 1.2);
    }
    gateIdx++;
  }
  if (player.pos.z < FINISH_Z) finishRun('finish');
}

function updateHud() {
  const m = mode();
  ui.speed.textContent = Math.round(player.speed * 3.6);
  if (m.id === 'tricks') {
    ui.score.textContent = trickPoints;
    const left = m.time - runTime;
    ui.timer.textContent = fmtClock(left);
    ui.timer.classList.toggle('warn', left < 10);
  } else if (m.slalom) {
    ui.timer.textContent = fmtTime(runTime + penalty);
    ui.subinfo.textContent = `Tor ${Math.min(gateIdx + 1, GATE_COUNT)} / ${GATE_COUNT}${penalty ? ` · +${penalty} s` : ''}`;
  } else {
    ui.score.textContent = distanceScore();
  }
}

// ---------- Spielschleife ----------
const timer = new THREE.Timer();
timer.connect(document);
const STEP = 1 / 120;
let acc = 0;

function frame(time) {
  timer.update(time);
  const rawDt = timer.getDelta();
  const dt = Math.min(rawDt, 0.05);

  if (state === 'playing') {
    input.update(dt);
    acc += dt;
    while (acc >= STEP) {
      player.step(STEP, input, world);
      acc -= STEP;
    }
    handleEvents();
    minZ = Math.min(minZ, player.pos.z);
    if (state === 'playing') {
      runTime += dt;
      const m = mode();
      if (m.slalom) checkGates();
      if (m.time && runTime >= m.time) finishRun('time');
    }
    if (state === 'playing') updateHud();
  } else if (state === 'countdown') {
    const before = Math.ceil(countdownT);
    countdownT -= Math.min(rawDt, 0.5); // echte Zeit, auch bei langsamen Geräten
    const now = Math.ceil(countdownT);
    if (now !== before) {
      if (now > 0) {
        ui.countdown.textContent = String(now);
        audio.beep(false);
      } else {
        ui.countdown.textContent = 'LOS!';
        audio.beep(true);
        setState('playing');
        ui.countdown.classList.remove('hidden');
        setTimeout(() => ui.countdown.classList.add('hidden'), 700);
      }
    }
  } else if (state === 'menu') {
    // Show-Fahrt: der Autopilot fährt und springt (ohne Kollisionen)
    player.noCollide = true;
    acc += dt;
    while (acc >= STEP) {
      player.step(STEP, pilot.update(player), world);
      acc -= STEP;
    }
    for (const ev of player.events) {
      if (ev.type === 'land') fx.burst(player.pos, 20 + Math.min(40, ev.impact * 4), 2 + ev.impact * 0.2);
      if (ev.type === 'respawn') {
        respawnAt(player.pos.z - 2);
        cine.reset(player);
      }
    }
    player.events.length = 0;
  }

  world.update(player.pos.z);
  player.update(dt);
  if (state === 'menu') cine.update(dt, player, pilot);
  else if (state !== 'paused') chase.update(dt, player);
  fx.update(state === 'paused' ? 0 : dt, camera, player, input);
  audio.update(player, dt);
  if (mobile) updateTouchLabels();

  // Sonne, Himmel und Berge wandern mit
  sunLight.position.copy(player.pos).addScaledVector(sun, 90);
  sunLight.target.position.copy(player.pos);
  sky.position.copy(camera.position);
  sky.material.uniforms.time.value += dt;
  mountains.position.set(camera.position.x, player.pos.y - 420, camera.position.z);

  if (popupTimer > 0) {
    popupTimer -= dt;
    if (popupTimer <= 0) ui.popup.classList.remove('show');
  }

  if (QUALITY[quality].post && composer) composer.render(dt);
  else renderer.render(scene, camera);
  if (!window.__mxReady) {
    window.__mxReady = true;
    const boot = document.getElementById('boot');
    if (boot) boot.hidden = true;
    if (qualityLowered) showPopup(`Grafik auf „${QUALITY[quality].label}“ reduziert,<br><small>weil das Spiel beim letzten Start abgestürzt ist</small>`, false, 4);
  }
  requestAnimationFrame(frame);
}

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  if (composer) composer.setSize(window.innerWidth, window.innerHeight);
});

enterMenu();
frame();

// Für automatische Tests
window.__game = {
  player, input, world, pisteCenter, heightAt, featuresNear, slotFeatures, railLine, chase, pilot, audio, renderer, scene,
  get state() { return state; }, startGame, enterMenu, setMode: (i) => { modeIdx = i; renderModes(); },
};
