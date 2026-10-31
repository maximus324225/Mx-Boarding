// Klarer, tiefblauer Bergsommer-/Winterhimmel mit Sonne.
// Farbverlauf: dunkles Blau oben, helles Blau am Horizont, Sonnenschein.
import * as THREE from 'three';

export const SKY = {
  zenith: new THREE.Color(0x1556c4),
  mid: new THREE.Color(0x3d8cf0),
  horizon: new THREE.Color(0xbfdcf7),
};

export function createSky(sunDir) {
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: {
      zenith: { value: SKY.zenith },
      mid: { value: SKY.mid },
      horizon: { value: SKY.horizon },
      sunDir: { value: sunDir.clone().normalize() },
      time: { value: 0 },
    },
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        gl_Position = p.xyww; // immer ganz hinten
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 zenith;
      uniform vec3 mid;
      uniform vec3 horizon;
      uniform vec3 sunDir;
      uniform float time;
      varying vec3 vDir;
      float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float noise(vec2 p) {
        vec2 i = floor(p); vec2 f = fract(p);
        vec2 u = f * f * (3.0 - 2.0 * f);
        return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
      }
      float fbm(vec2 p) {
        float s = 0.0; float a = 0.5;
        for (int i = 0; i < 5; i++) { s += noise(p) * a; p *= 2.03; a *= 0.5; }
        return s;
      }
      void main() {
        vec3 d = normalize(vDir);
        float h = d.y;
        vec3 col = mix(horizon, mid, smoothstep(-0.02, 0.22, h));
        col = mix(col, zenith, smoothstep(0.22, 0.85, h));
        // Schönwetterwolken
        if (h > 0.0) {
          vec2 uv = d.xz / (h + 0.12) * 0.9 + vec2(time * 0.004, time * 0.002);
          float c = fbm(uv * 1.3);
          float cloud = smoothstep(0.52, 0.78, c) * smoothstep(0.0, 0.18, h);
          float shade = 0.82 + 0.18 * smoothstep(0.5, 0.9, fbm(uv * 1.3 + vec2(0.05, 0.08)));
          col = mix(col, vec3(1.0, 1.0, 1.0) * shade, cloud * 0.85);
        }
        float s = max(dot(d, normalize(sunDir)), 0.0);
        col += vec3(1.0, 0.96, 0.88) * (pow(s, 1200.0) * 4.0 + pow(s, 60.0) * 0.35 + pow(s, 6.0) * 0.08);
        gl_FragColor = vec4(col, 1.0);
        #include <colorspace_fragment>
      }
    `,
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(1000, 32, 16), mat);
  mesh.renderOrder = -1;
  mesh.frustumCulled = false;
  return mesh;
}
