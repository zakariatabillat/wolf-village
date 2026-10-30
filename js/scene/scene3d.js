// ============================================================
//  SCÈNE 3D — le village de Brumeval (Three.js r160)
//  Feu de camp, maisons, forêt, ciel jour/nuit, villageois animés.
//  La scène ne connaît PAS les règles : main.js lui dit quoi montrer.
// ============================================================
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

const SKIN = ['#f1c27d', '#e0ac69', '#c68642', '#8d5524', '#ffdbac', '#d4a373', '#a86b3c', '#f3d1b0'];
const ROLE_CHIP = { loup: '🐺 Loup-Garou', villageois: '🧑‍🌾 Villageois', voyante: '🔮 Voyante', sorciere: '🧪 Sorcière', chasseur: '🏹 Chasseur' };

// Petit bruit pseudo-aléatoire déterministe (pour placer arbres/rochers toujours pareil)
function hash(n) { const s = Math.sin(n * 127.1) * 43758.5453; return s - Math.floor(s); }
/** Hauteur du terrain : plat au centre, collines au-delà de 26 m. */
function heightAt(x, z) {
  const r = Math.hypot(x, z);
  const k = THREE.MathUtils.smoothstep(r, 26, 70);
  return k * (Math.sin(x * 0.11) * Math.cos(z * 0.09) * 3.2 + Math.sin(x * 0.05 + z * 0.07) * 4 + 4.5);
}
const ease = (t) => t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;

export function createVillageScene(container, labelsLayer, { onPick } = {}) {
  // ---------- Moteur ----------
  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
  renderer.setSize(container.clientWidth, container.clientHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0x0a0e1e, 0.02);

  const camera = new THREE.PerspectiveCamera(46, container.clientWidth / container.clientHeight, 0.1, 500);
  camera.position.set(0, 10.5, 19);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(0, 1.4, 0);
  controls.enableDamping = true;
  controls.dampingFactor = 0.06;
  controls.enablePan = false;
  controls.minDistance = 6;
  controls.maxDistance = 38;
  controls.maxPolarAngle = Math.PI * 0.46;
  controls.autoRotate = true;
  controls.autoRotateSpeed = 0.35;

  // Post-traitement : halo lumineux (bloom) sur le feu, les fenêtres, les yeux des loups
  let composer = null; let bloom = null;
  try {
    composer = new EffectComposer(renderer);
    composer.addPass(new RenderPass(scene, camera));
    bloom = new UnrealBloomPass(new THREE.Vector2(container.clientWidth, container.clientHeight), 0.8, 0.55, 0.82);
    composer.addPass(bloom);
    composer.addPass(new OutputPass());
  } catch (e) { console.warn('Bloom indisponible', e); composer = null; }

  // ---------- Ciel (dôme dégradé) ----------
  const skyUniforms = {
    top: { value: new THREE.Color('#050816') },
    horizon: { value: new THREE.Color('#1a2350') },
    bottom: { value: new THREE.Color('#0a0e1e') },
  };
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(260, 32, 16),
    new THREE.ShaderMaterial({
      uniforms: skyUniforms, side: THREE.BackSide, depthWrite: false, fog: false,
      vertexShader: `varying vec3 vPos; void main(){ vPos = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
      fragmentShader: `uniform vec3 top; uniform vec3 horizon; uniform vec3 bottom; varying vec3 vPos;
        void main(){ float h = normalize(vPos).y;
          vec3 c = h > 0.0 ? mix(horizon, top, pow(smoothstep(0.0, 0.6, h), 0.8)) : mix(horizon, bottom, smoothstep(0.0, 0.2, -h));
          gl_FragColor = vec4(c, 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    }),
  );
  scene.add(sky);

  // Étoiles
  const starGeo = new THREE.BufferGeometry();
  const starPos = [];
  for (let i = 0; i < 1400; i++) {
    const u = hash(i + 1), v = hash(i + 999);
    const theta = u * Math.PI * 2, phi = Math.acos(1 - v * 0.95);
    starPos.push(Math.sin(phi) * Math.cos(theta) * 240, Math.cos(phi) * 240, Math.sin(phi) * Math.sin(theta) * 240);
  }
  starGeo.setAttribute('position', new THREE.Float32BufferAttribute(starPos, 3));
  const starMat = new THREE.PointsMaterial({ color: 0xffffff, size: 1.1, sizeAttenuation: false, transparent: true, opacity: 1, fog: false, depthWrite: false });
  scene.add(new THREE.Points(starGeo, starMat));

  // Lune & soleil
  const glowTex = makeGlowTexture();
  const moon = new THREE.Group();
  const moonMat = new THREE.MeshBasicMaterial({ color: new THREE.Color('#f4ecd8').multiplyScalar(2.2), fog: false });
  moon.add(new THREE.Mesh(new THREE.SphereGeometry(6, 32, 16), moonMat));
  const moonGlow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: '#c9d4ff', transparent: true, opacity: 0.55, depthWrite: false, fog: false, blending: THREE.AdditiveBlending }));
  moonGlow.scale.set(60, 60, 1); moon.add(moonGlow);
  moon.position.set(-70, 95, -150);
  scene.add(moon);
  const sun = new THREE.Group();
  sun.add(new THREE.Mesh(new THREE.SphereGeometry(8, 32, 16), new THREE.MeshBasicMaterial({ color: new THREE.Color('#fff2c8').multiplyScalar(3), fog: false })));
  const sunGlow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: '#ffd27a', transparent: true, opacity: 0.7, depthWrite: false, fog: false, blending: THREE.AdditiveBlending }));
  sunGlow.scale.set(90, 90, 1); sun.add(sunGlow);
  sun.position.set(90, 110, -120);
  scene.add(sun);

  // ---------- Lumières ----------
  const hemi = new THREE.HemisphereLight(0x8ea6ff, 0x1b2416, 0.3);
  scene.add(hemi);
  const dirLight = new THREE.DirectionalLight(0x9fb4ff, 0.6);
  dirLight.castShadow = true;
  dirLight.shadow.mapSize.set(2048, 2048);
  Object.assign(dirLight.shadow.camera, { left: -26, right: 26, top: 26, bottom: -26, near: 1, far: 120 });
  dirLight.shadow.camera.updateProjectionMatrix();
  dirLight.shadow.bias = -0.0004;
  dirLight.shadow.normalBias = 0.03;
  scene.add(dirLight, dirLight.target);
  const fireLight = new THREE.PointLight(0xff8a3d, 80, 30, 1.8);
  fireLight.position.set(0, 1.6, 0);
  scene.add(fireLight);

  // ---------- Terrain ----------
  const groundGeo = new THREE.PlaneGeometry(300, 300, 150, 150);
  groundGeo.rotateX(-Math.PI / 2);
  const gp = groundGeo.attributes.position;
  const gcol = [];
  const cA = new THREE.Color('#2e4a24'), cB = new THREE.Color('#41622d'), cC = new THREE.Color('#5b5f3a');
  for (let i = 0; i < gp.count; i++) {
    const x = gp.getX(i), z = gp.getZ(i);
    const y = heightAt(x, z);
    gp.setY(i, y);
    const c = cA.clone().lerp(cB, hash(i * 0.37) * 0.6).lerp(cC, THREE.MathUtils.clamp(y / 12, 0, 0.6));
    gcol.push(c.r, c.g, c.b);
  }
  groundGeo.setAttribute('color', new THREE.Float32BufferAttribute(gcol, 3));
  groundGeo.computeVertexNormals();
  const ground = new THREE.Mesh(groundGeo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, flatShading: true }));
  ground.receiveShadow = true;
  scene.add(ground);

  // Place du village (pavés)
  const plaza = new THREE.Mesh(new THREE.CylinderGeometry(9.2, 9.6, 0.16, 56), new THREE.MeshStandardMaterial({ color: '#5d564f', roughness: 0.95 }));
  plaza.position.y = 0.05; plaza.receiveShadow = true; scene.add(plaza);
  const cobbleGeo = new THREE.BoxGeometry(0.7, 0.18, 0.45);
  const cobbleMat = new THREE.MeshStandardMaterial({ color: '#7a7066', roughness: 1, flatShading: true });
  const cobbles = new THREE.InstancedMesh(cobbleGeo, cobbleMat, 64);
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), s3 = new THREE.Vector3(), p3 = new THREE.Vector3();
  for (let i = 0; i < 64; i++) {
    const a = (i / 64) * Math.PI * 2;
    p3.set(Math.cos(a) * 9.5, 0.1, Math.sin(a) * 9.5);
    q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), -a);
    s3.set(1, 0.8 + hash(i) * 0.5, 1);
    cobbles.setMatrixAt(i, m4.compose(p3, q, s3));
  }
  cobbles.receiveShadow = true; scene.add(cobbles);

  // ---------- Feu de camp ----------
  const fire = new THREE.Group(); scene.add(fire);
  const stoneMat = new THREE.MeshStandardMaterial({ color: '#6f6a64', roughness: 1, flatShading: true });
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    const st = new THREE.Mesh(new THREE.DodecahedronGeometry(0.26 + hash(i + 3) * 0.08), stoneMat);
    st.position.set(Math.cos(a) * 1.05, 0.2, Math.sin(a) * 1.05); st.rotation.set(hash(i), hash(i + 1), 0);
    st.castShadow = true; fire.add(st);
  }
  const logMat = new THREE.MeshStandardMaterial({ color: '#4a2f1d', roughness: 1, flatShading: true });
  for (let i = 0; i < 4; i++) {
    const log = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.14, 1.5, 7), logMat);
    log.position.y = 0.3; log.rotation.set(Math.PI / 2 - 0.35, (i / 4) * Math.PI, 0);
    fire.add(log);
  }
  const flames = [];
  const flameCols = ['#ff4b1f', '#ff7b25', '#ffb347', '#ffe28a'];
  for (let i = 0; i < 6; i++) {
    const mat = new THREE.MeshBasicMaterial({ color: new THREE.Color(flameCols[i % 4]).multiplyScalar(2.4), transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false });
    const f = new THREE.Mesh(new THREE.ConeGeometry(0.42 - i * 0.05, 1.5 - i * 0.12, 8, 1, true), mat);
    f.position.set((hash(i + 7) - 0.5) * 0.3, 0.95, (hash(i + 9) - 0.5) * 0.3);
    f.userData.phase = hash(i + 11) * 10;
    flames.push(f); fire.add(f);
  }
  // Braises qui montent
  const EMBERS = 140;
  const emberGeo = new THREE.BufferGeometry();
  const emberPos = new Float32Array(EMBERS * 3);
  const emberVel = [];
  for (let i = 0; i < EMBERS; i++) { resetEmber(i, true); }
  function resetEmber(i, randomY) {
    emberPos[i * 3] = (Math.random() - 0.5) * 0.6;
    emberPos[i * 3 + 1] = randomY ? Math.random() * 5 : 0.6;
    emberPos[i * 3 + 2] = (Math.random() - 0.5) * 0.6;
    emberVel[i] = { x: (Math.random() - 0.5) * 0.35, y: 0.8 + Math.random() * 1.3, z: (Math.random() - 0.5) * 0.35 };
  }
  emberGeo.setAttribute('position', new THREE.BufferAttribute(emberPos, 3));
  const emberMat = new THREE.PointsMaterial({ color: new THREE.Color('#ffb347').multiplyScalar(3), size: 0.09, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false });
  const embers = new THREE.Points(emberGeo, emberMat); scene.add(embers);

  // ---------- Maisons ----------
  const windowMat = new THREE.MeshStandardMaterial({ color: '#2a1a0a', emissive: '#ffb54a', emissiveIntensity: 2.4 });
  const plasters = ['#d9c7a3', '#cdb891', '#bfa77f', '#e0d2b4', '#c9b18a'];
  const roofs = ['#7a3b2e', '#5b3a29', '#6d4c3d', '#8a4a32'];
  const beamMat = new THREE.MeshStandardMaterial({ color: '#3b2618', roughness: 1 });
  const HOUSES = 11;
  for (let i = 0; i < HOUSES; i++) {
    const a = (i / HOUSES) * Math.PI * 2 + hash(i) * 0.25;
    const r = 18.5 + hash(i + 20) * 4;
    scene.add(buildHouse(i, Math.cos(a) * r, Math.sin(a) * r));
  }
  function buildHouse(i, x, z) {
    const g = new THREE.Group();
    const w = 3 + hash(i + 1) * 1.4, h = 2.3 + hash(i + 2) * 0.9, d = 2.8 + hash(i + 3);
    const walls = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshStandardMaterial({ color: plasters[i % plasters.length], roughness: 0.95 }));
    walls.position.y = h / 2; walls.castShadow = walls.receiveShadow = true; g.add(walls);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      const b = new THREE.Mesh(new THREE.BoxGeometry(0.16, h, 0.16), beamMat);
      b.position.set(sx * (w / 2), h / 2, sz * (d / 2)); g.add(b);
    }
    const band = new THREE.Mesh(new THREE.BoxGeometry(w + 0.05, 0.14, d + 0.05), beamMat); band.position.y = h * 0.55; g.add(band);
    const roof = new THREE.Mesh(new THREE.ConeGeometry(1, 1.7 + hash(i + 4) * 0.6, 4), new THREE.MeshStandardMaterial({ color: roofs[i % roofs.length], roughness: 0.9, flatShading: true }));
    roof.rotation.y = Math.PI / 4; roof.scale.set(w * 0.78, 1, d * 0.78); roof.position.y = h + 0.85; roof.castShadow = true; g.add(roof);
    const chim = new THREE.Mesh(new THREE.BoxGeometry(0.4, 1.2, 0.4), stoneMat); chim.position.set(w * 0.25, h + 1.1, -d * 0.15); chim.castShadow = true; g.add(chim);
    const door = new THREE.Mesh(new THREE.BoxGeometry(0.7, 1.25, 0.06), beamMat); door.position.set(0, 0.62, d / 2 + 0.02); g.add(door);
    for (const sx of [-1, 1]) {
      const win = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.5, 0.06), windowMat);
      win.position.set(sx * w * 0.3, h * 0.62, d / 2 + 0.02); g.add(win);
    }
    g.position.set(x, heightAt(x, z), z);
    g.lookAt(0, g.position.y, 0);
    return g;
  }

  // Lanternes autour de la place (pas de lumière réelle : juste du bloom)
  const lanternMat = new THREE.MeshBasicMaterial({ color: new THREE.Color('#ffc46b').multiplyScalar(2.5) });
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + 0.3;
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.08, 2.6, 6), beamMat);
    pole.position.set(Math.cos(a) * 10.6, 1.3, Math.sin(a) * 10.6); pole.castShadow = true; scene.add(pole);
    const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.38, 0.3), lanternMat);
    lamp.position.set(Math.cos(a) * 10.6, 2.75, Math.sin(a) * 10.6); scene.add(lamp);
  }

  // ---------- Forêt (instanciée = rapide) ----------
  const TREES = 220;
  const trunkMesh = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.16, 0.24, 1.4, 6), new THREE.MeshStandardMaterial({ color: '#3d2a1c', roughness: 1 }), TREES);
  const leafMesh = new THREE.InstancedMesh(new THREE.ConeGeometry(1, 2.1, 7), new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.9, flatShading: true }), TREES * 3);
  const leafCols = ['#1f3b24', '#24472a', '#2c5530', '#1a3320', '#33603a'].map(c => new THREE.Color(c));
  let li = 0;
  for (let i = 0; i < TREES; i++) {
    const a = hash(i + 100) * Math.PI * 2;
    const r = 27 + Math.pow(hash(i + 200), 0.7) * 70;
    const x = Math.cos(a) * r, z = Math.sin(a) * r, y = heightAt(x, z);
    const sc = 0.9 + hash(i + 300) * 1.3;
    trunkMesh.setMatrixAt(i, m4.compose(p3.set(x, y + 0.7 * sc, z), q.identity(), s3.set(sc, sc, sc)));
    for (let k = 0; k < 3; k++) {
      const ks = sc * (1.35 - k * 0.3);
      leafMesh.setMatrixAt(li, m4.compose(p3.set(x, y + sc * (1.9 + k * 1.05), z), q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), hash(i + k)), s3.set(ks, sc, ks)));
      leafMesh.setColorAt(li, leafCols[(i + k) % leafCols.length]);
      li++;
    }
  }
  trunkMesh.castShadow = leafMesh.castShadow = true;
  scene.add(trunkMesh, leafMesh);

  // Rochers
  const rocks = new THREE.InstancedMesh(new THREE.DodecahedronGeometry(1), stoneMat, 50);
  for (let i = 0; i < 50; i++) {
    const a = hash(i + 500) * Math.PI * 2, r = 13 + hash(i + 600) * 50;
    const x = Math.cos(a) * r, z = Math.sin(a) * r, sc = 0.25 + hash(i + 700) * 0.7;
    rocks.setMatrixAt(i, m4.compose(p3.set(x, heightAt(x, z) + sc * 0.3, z), q.setFromEuler(new THREE.Euler(hash(i), hash(i + 1), 0)), s3.set(sc, sc * 0.7, sc)));
  }
  rocks.castShadow = rocks.receiveShadow = true; scene.add(rocks);

  // Lucioles
  const FLIES = 90;
  const flyGeo = new THREE.BufferGeometry();
  const flyBase = [];
  const flyPos = new Float32Array(FLIES * 3);
  for (let i = 0; i < FLIES; i++) { const a = hash(i + 800) * Math.PI * 2, r = 10 + hash(i + 900) * 18; flyBase.push([Math.cos(a) * r, 0.6 + hash(i + 1000) * 2.6, Math.sin(a) * r]); }
  flyGeo.setAttribute('position', new THREE.BufferAttribute(flyPos, 3));
  const flyMat = new THREE.PointsMaterial({ color: new THREE.Color('#d4ff7a').multiplyScalar(3), size: 0.12, transparent: true, opacity: 1, blending: THREE.AdditiveBlending, depthWrite: false });
  scene.add(new THREE.Points(flyGeo, flyMat));

  // Yeux de loups dans la forêt
  const eyes = new THREE.Group(); eyes.visible = false; scene.add(eyes);
  const eyeMat = new THREE.MeshBasicMaterial({ color: new THREE.Color('#ff2a2a').multiplyScalar(5), transparent: true });
  for (let i = 0; i < 9; i++) {
    const a = hash(i + 1200) * Math.PI * 2, r = 27 + hash(i + 1300) * 6;
    const pair = new THREE.Group();
    for (const sx of [-0.13, 0.13]) { const e = new THREE.Mesh(new THREE.SphereGeometry(0.055, 8, 6), eyeMat); e.position.x = sx; pair.add(e); }
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    pair.position.set(x, heightAt(x, z) + 0.7, z);
    pair.lookAt(0, pair.position.y, 0);
    pair.userData.phase = hash(i + 1400) * 20;
    eyes.add(pair);
  }

  // ---------- Joueurs ----------
  const figures = new Map(); // id -> { group, body, ring, hit, crown, tomb, label, ... }
  const hitMeshes = [];
  const effects = []; // animations temporaires { update(dt) → bool (true = continuer) }
  let selectable = null;
  let selectedId = null;
  let hoverId = null;

  function clearPlayers() {
    for (const f of figures.values()) { scene.remove(f.group); f.label.remove(); }
    figures.clear(); hitMeshes.length = 0;
    clearVoteLines();
  }

  function setPlayers(players) {
    clearPlayers();
    const n = players.length;
    const R = THREE.MathUtils.clamp(3.4 + n * 0.3, 4.6, 7.4);
    players.forEach((p, i) => {
      const a = (i / n) * Math.PI * 2 + Math.PI / 2;
      const f = buildFigure(p, i);
      f.group.position.set(Math.cos(a) * R, 0.13, Math.sin(a) * R);
      f.group.lookAt(0, 0.13, 0);
      f.home = f.group.position.clone();
      scene.add(f.group);
      figures.set(p.id, f);
      if (!p.alive) instantDead(f);
      if (p.isMayor) setMayor(p.id);
    });
  }

  function buildFigure(p, i) {
    const group = new THREE.Group();
    const body = new THREE.Group(); group.add(body);
    const cloak = new THREE.MeshStandardMaterial({ color: p.color, roughness: 0.75, flatShading: true });
    const dark = new THREE.MeshStandardMaterial({ color: new THREE.Color(p.color).multiplyScalar(0.55), roughness: 0.8, flatShading: true });
    const skin = new THREE.MeshStandardMaterial({ color: SKIN[i % SKIN.length], roughness: 0.7 });
    const eyeM = new THREE.MeshStandardMaterial({ color: '#141414', roughness: 0.3 });

    const robe = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.6, 1.35, 10), cloak); robe.position.y = 0.68;
    const belt = new THREE.Mesh(new THREE.TorusGeometry(0.37, 0.05, 6, 16), new THREE.MeshStandardMaterial({ color: '#3b2618' })); belt.rotation.x = Math.PI / 2; belt.position.y = 0.98;
    const torso = new THREE.Mesh(new THREE.SphereGeometry(0.33, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), cloak); torso.position.y = 1.33;
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.29, 20, 14), skin); head.position.y = 1.64;
    // capuche : sphère ouverte devant (+z) pour laisser voir le visage
    const hood = new THREE.Mesh(new THREE.SphereGeometry(0.35, 16, 12, Math.PI * 0.7, Math.PI * 1.6, 0, Math.PI * 0.62), dark); hood.position.set(0, 1.66, -0.02);
    const tip = new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.35, 8), dark); tip.position.set(0, 1.98, -0.12); tip.rotation.x = -0.5;
    body.add(robe, belt, torso, head, hood, tip);
    for (const sx of [-1, 1]) {
      const e = new THREE.Mesh(new THREE.SphereGeometry(0.045, 8, 6), eyeM); e.position.set(sx * 0.1, 1.67, 0.255); body.add(e);
      const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.1, 0.72, 7), cloak); arm.position.set(sx * 0.37, 1.02, 0.04); arm.rotation.z = sx * 0.22; body.add(arm);
      const hand = new THREE.Mesh(new THREE.SphereGeometry(0.08, 8, 6), skin); hand.position.set(sx * 0.45, 0.66, 0.06); body.add(hand);
    }
    body.traverse(o => { if (o.isMesh) o.castShadow = true; });

    // Anneau de sélection au sol
    const ringMat = new THREE.MeshBasicMaterial({ color: new THREE.Color('#e9c46a').multiplyScalar(2), transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide });
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.72, 0.9, 48), ringMat); ring.rotation.x = -Math.PI / 2; ring.position.y = 0.04; group.add(ring);

    // Zone cliquable invisible (plus grande que le personnage)
    const hit = new THREE.Mesh(new THREE.CylinderGeometry(0.75, 0.75, 2.4, 8), new THREE.MeshBasicMaterial({ visible: false }));
    hit.position.y = 1.15; hit.userData.id = p.id; group.add(hit); hitMeshes.push(hit);

    // Couronne de maire
    const crown = new THREE.Group(); crown.visible = false;
    const gold = new THREE.MeshStandardMaterial({ color: '#ffcf4a', metalness: 0.9, roughness: 0.25, emissive: '#7a4f00', emissiveIntensity: 0.6 });
    const band = new THREE.Mesh(new THREE.TorusGeometry(0.2, 0.045, 8, 24), gold); band.rotation.x = Math.PI / 2; crown.add(band);
    for (let k = 0; k < 5; k++) { const sp = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.16, 6), gold); const a = (k / 5) * Math.PI * 2; sp.position.set(Math.cos(a) * 0.2, 0.1, Math.sin(a) * 0.2); crown.add(sp); }
    crown.position.y = 2.22; body.add(crown);

    // Étiquette HTML
    const label = document.createElement('div');
    label.className = 'plabel';
    label.style.setProperty('--c', p.color);
    label.innerHTML = `<div class="bubble hidden"></div><div class="badge hidden"></div><div class="prole hidden"></div><div class="pname"></div>`;
    label.querySelector('.pname').textContent = p.name;
    labelsLayer.appendChild(label);

    return { id: p.id, group, body, ring, ringMat, hit, crown, label, mats: [cloak, dark, skin], phase: Math.random() * 10, dead: false, speaking: 0, anim: null, tomb: null };
  }

  function makeTomb() {
    const g = new THREE.Group();
    const m = new THREE.MeshStandardMaterial({ color: '#8a8d91', roughness: 0.95, flatShading: true });
    const slab = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.8, 0.18), m); slab.position.y = 0.4;
    const dome = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.35, 0.18, 20, 1, false, Math.PI / 2, Math.PI), m);
    dome.rotation.x = Math.PI / 2; dome.position.y = 0.8;
    const mound = new THREE.Mesh(new THREE.SphereGeometry(0.6, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2), new THREE.MeshStandardMaterial({ color: '#3a2c1f', roughness: 1 }));
    mound.scale.set(1, 0.25, 1.4); mound.position.z = 0.55;
    const candle = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.18, 8), new THREE.MeshStandardMaterial({ color: '#efe6d2' }));
    candle.position.set(0.25, 0.09, 0.3);
    const flame = new THREE.Mesh(new THREE.SphereGeometry(0.04, 8, 6), new THREE.MeshBasicMaterial({ color: new THREE.Color('#ffb347').multiplyScalar(4) }));
    flame.position.set(0.25, 0.22, 0.3); flame.scale.y = 1.6;
    g.add(slab, dome, mound, candle, flame);
    g.traverse(o => { if (o.isMesh) o.castShadow = o.receiveShadow = true; });
    return g;
  }

  function instantDead(f) {
    f.dead = true; f.body.visible = false; f.label.classList.add('dead');
    f.tomb = makeTomb(); f.group.add(f.tomb);
  }

  /** Animation de mort : le personnage tombe, un fantôme s'élève, une tombe sort de terre. */
  function kill(id, role) {
    const f = figures.get(id); if (!f || f.dead) return;
    f.dead = true; f.label.classList.add('dead');
    if (role) showRole(id, role);
    for (const m of f.mats) { m.transparent = true; m.needsUpdate = true; }
    const tomb = makeTomb(); tomb.position.y = -1.2; f.group.add(tomb); f.tomb = tomb;
    // fantôme
    const ghost = new THREE.Mesh(new THREE.SphereGeometry(0.35, 16, 12), new THREE.MeshBasicMaterial({ color: new THREE.Color('#cfe3ff').multiplyScalar(1.6), transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending }));
    ghost.scale.y = 1.6; ghost.position.y = 1.2; f.group.add(ghost);
    let t = 0;
    effects.push({ update(dt) {
      t += dt;
      const fall = ease(Math.min(1, t / 1.1));
      f.body.rotation.x = -fall * Math.PI / 2;
      f.body.position.y = -fall * 0.25 - Math.max(0, t - 1.2) * 0.6;
      for (const m of f.mats) m.opacity = 1 - THREE.MathUtils.clamp((t - 1.0) / 1.0, 0, 1);
      ghost.position.y = 1.2 + t * 1.2;
      ghost.material.opacity = Math.sin(Math.min(1, t / 3) * Math.PI) * 0.55;
      tomb.position.y = -1.2 + ease(THREE.MathUtils.clamp((t - 1.2) / 1.0, 0, 1)) * 1.2;
      if (t > 3.2) { f.body.visible = false; f.group.remove(ghost); return false; }
      return true;
    } });
    burst(f.group.position, '#ff3b3b');
  }

  // ---------- Effets ----------
  /** Colonne de lumière sur un joueur (voyante = violet, sorcière = vert, loups = rouge). */
  function beam(id, color = '#b388ff', duration = 2.2) {
    const f = figures.get(id); if (!f) return;
    const mat = new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(2), transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
    const col = new THREE.Mesh(new THREE.CylinderGeometry(0.8, 0.95, 24, 32, 1, true), mat);
    col.position.copy(f.group.position).setY(12);
    scene.add(col);
    burst(f.group.position, color);
    let t = 0;
    effects.push({ update(dt) {
      t += dt; const k = t / duration;
      mat.opacity = Math.sin(Math.min(1, k) * Math.PI) * 0.45;
      col.rotation.y += dt;
      if (k >= 1) { scene.remove(col); col.geometry.dispose(); mat.dispose(); return false; }
      return true;
    } });
  }

  /** Onde circulaire au sol. */
  function burst(pos, color) {
    const mat = new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(2.5), transparent: true, opacity: 0.9, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending });
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.5, 0.62, 48), mat);
    ring.rotation.x = -Math.PI / 2; ring.position.copy(pos).setY(0.2); scene.add(ring);
    let t = 0;
    effects.push({ update(dt) {
      t += dt; const s = 1 + t * 4; ring.scale.set(s, s, s); mat.opacity = Math.max(0, 0.9 - t * 0.9);
      if (t > 1) { scene.remove(ring); ring.geometry.dispose(); mat.dispose(); return false; }
      return true;
    } });
  }

  // Lignes de vote (arcs lumineux du votant vers sa cible)
  const voteLines = [];
  function voteLine(fromId, toId, color = '#e63946') {
    const a = figures.get(fromId), b = figures.get(toId); if (!a || !b) return;
    const p0 = a.group.position.clone().setY(1.9), p2 = b.group.position.clone().setY(1.9);
    const p1 = p0.clone().lerp(p2, 0.5).setY(3.2 + p0.distanceTo(p2) * 0.18);
    const curve = new THREE.QuadraticBezierCurve3(p0, p1, p2);
    const geo = new THREE.TubeGeometry(curve, 40, 0.035, 6, false);
    const mat = new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(1.8), transparent: true, opacity: 0.9, depthWrite: false, blending: THREE.AdditiveBlending });
    const mesh = new THREE.Mesh(geo, mat);
    const total = geo.index.count; geo.setDrawRange(0, 0);
    scene.add(mesh); voteLines.push(mesh);
    let t = 0;
    effects.push({ update(dt) {
      t += dt; const k = Math.min(1, t / 0.55);
      geo.setDrawRange(0, Math.floor((total * ease(k)) / 3) * 3);
      if (k >= 1) { burst(b.group.position, color); return false; }
      return true;
    } });
  }
  function clearVoteLines() {
    for (const m of voteLines) { scene.remove(m); m.geometry.dispose(); m.material.dispose(); }
    voteLines.length = 0;
  }

  // ---------- Étiquettes ----------
  function setBadge(id, n, gold = false) {
    const f = figures.get(id); if (!f) return;
    const el = f.label.querySelector('.badge');
    if (!n) { el.classList.add('hidden'); return; }
    el.textContent = n; el.classList.toggle('gold', gold); el.classList.remove('hidden');
    el.style.animation = 'none'; void el.offsetWidth; el.style.animation = '';
  }
  function clearBadges() { for (const id of figures.keys()) setBadge(id, 0); }
  function showRole(id, role) {
    const f = figures.get(id); if (!f) return;
    const el = f.label.querySelector('.prole');
    el.textContent = ROLE_CHIP[role] ?? role; el.classList.toggle('wolf', role === 'loup'); el.classList.remove('hidden');
  }
  function hideRole(id) { figures.get(id)?.label.querySelector('.prole').classList.add('hidden'); }
  function say(id, text, ms = 4200, accuse = false) {
    const f = figures.get(id); if (!f) return;
    const el = f.label.querySelector('.bubble');
    el.textContent = text; el.classList.toggle('accuse', accuse); el.classList.remove('hidden');
    el.style.animation = 'none'; void el.offsetWidth; el.style.animation = '';
    f.speaking = ms / 1000;
    clearTimeout(f.sayTimer); f.sayTimer = setTimeout(() => el.classList.add('hidden'), ms);
  }

  function setMayor(id) {
    for (const f of figures.values()) f.crown.visible = f.id === id;
    if (id && figures.get(id)) { burst(figures.get(id).group.position, '#ffcf4a'); }
  }

  // ---------- Sélection ----------
  function setSelectable(ids) {
    selectable = ids ? new Set(ids) : null;
    if (!ids) selectedId = null;
    controls.autoRotate = !ids && autoRotateWanted;
  }
  function setSelected(id) { selectedId = id; }

  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  let downAt = null;
  function pickAt(ev) {
    const rect = renderer.domElement.getBoundingClientRect();
    pointer.set(((ev.clientX - rect.left) / rect.width) * 2 - 1, -((ev.clientY - rect.top) / rect.height) * 2 + 1);
    raycaster.setFromCamera(pointer, camera);
    const hits = raycaster.intersectObjects(hitMeshes, false);
    return hits.length ? hits[0].object.userData.id : null;
  }
  renderer.domElement.addEventListener('pointerdown', (e) => { downAt = { x: e.clientX, y: e.clientY }; });
  renderer.domElement.addEventListener('pointerup', (e) => {
    if (!downAt || Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y) > 6) return;
    const id = pickAt(e);
    if (id && selectable?.has(id)) onPick?.(id);
  });
  renderer.domElement.addEventListener('pointermove', (e) => {
    if (!selectable) { hoverId = null; renderer.domElement.style.cursor = ''; return; }
    const id = pickAt(e);
    hoverId = id && selectable.has(id) ? id : null;
    renderer.domElement.style.cursor = hoverId ? 'pointer' : '';
  });

  // ---------- Caméra cinématique ----------
  let camGoal = null, targetGoal = null;
  let autoRotateWanted = true;
  controls.addEventListener('start', () => { camGoal = targetGoal = null; });
  function focus(id) {
    const f = figures.get(id); if (!f) return;
    const pos = f.group.position;
    const out = pos.clone().setY(0).normalize();
    camGoal = pos.clone().add(out.multiplyScalar(5.5)).setY(3.6);
    targetGoal = pos.clone().setY(1.3);
  }
  function resetCamera() {
    const ang = Math.atan2(camera.position.z, camera.position.x);
    camGoal = new THREE.Vector3(Math.cos(ang) * 18, 10, Math.sin(ang) * 18);
    targetGoal = new THREE.Vector3(0, 1.4, 0);
  }
  function setAutoRotate(on) { autoRotateWanted = on; controls.autoRotate = on && !selectable; }

  // ---------- Jour / Nuit ----------
  let tod = 0, todGoal = 0; // 0 = nuit, 1 = jour
  let blood = 0, bloodGoal = 0;
  const C = (h) => new THREE.Color(h);
  const NIGHT = { top: C('#03050f'), horizon: C('#18204a'), bottom: C('#080b18'), hemiSky: C('#7088ff'), hemiGround: C('#141c12'), light: C('#9fb4ff') };
  const DAY = { top: C('#2f6fc9'), horizon: C('#cfe8f5'), bottom: C('#9fbf96'), hemiSky: C('#cfe6ff'), hemiGround: C('#4a5a32'), light: C('#fff1d6') };
  const DUSK = C('#ff8a4c');
  const BLOOD = { top: C('#1a0205'), horizon: C('#5a0a12'), moon: C('#ff3b3b') };
  const tmp = new THREE.Color();
  function setTimeOfDay(mode) {
    todGoal = mode === 'day' ? 1 : 0;
    bloodGoal = mode === 'blood' ? 1 : 0;
  }
  function wolves(on) { eyes.visible = on; }

  function applyTime() {
    const t = tod, dusk = Math.pow(1 - Math.abs(2 * t - 1), 2);
    skyUniforms.top.value.copy(NIGHT.top).lerp(DAY.top, t).lerp(BLOOD.top, blood);
    skyUniforms.horizon.value.copy(NIGHT.horizon).lerp(DAY.horizon, t).lerp(DUSK, dusk * 0.7).lerp(BLOOD.horizon, blood);
    skyUniforms.bottom.value.copy(NIGHT.bottom).lerp(DAY.bottom, t);
    scene.fog.color.copy(skyUniforms.horizon.value).multiplyScalar(0.85);
    scene.fog.density = THREE.MathUtils.lerp(0.024, 0.009, t);
    hemi.color.copy(NIGHT.hemiSky).lerp(DAY.hemiSky, t);
    hemi.groundColor.copy(NIGHT.hemiGround).lerp(DAY.hemiGround, t);
    hemi.intensity = THREE.MathUtils.lerp(0.32, 1.25, t);
    dirLight.color.copy(NIGHT.light).lerp(DAY.light, t).lerp(DUSK, dusk * 0.6).lerp(BLOOD.moon, blood * 0.8);
    dirLight.intensity = THREE.MathUtils.lerp(0.75, 2.8, t);
    const src = t > 0.5 ? sun.position : moon.position;
    dirLight.position.copy(src).normalize().multiplyScalar(40);
    starMat.opacity = 1 - t;
    moon.visible = t < 0.85; moon.position.y = 95 - t * 140;
    moonMat.color.copy(C('#f4ecd8')).lerp(BLOOD.moon, blood).multiplyScalar(2.2);
    moonGlow.material.color.copy(C('#c9d4ff')).lerp(BLOOD.moon, blood);
    sun.visible = t > 0.15; sun.position.y = -30 + t * 140;
    windowMat.emissiveIntensity = THREE.MathUtils.lerp(2.6, 0.05, t);
    lanternMat.color.copy(C('#ffc46b')).multiplyScalar(THREE.MathUtils.lerp(2.6, 0.9, t));
    flyMat.opacity = 1 - t;
    if (bloom) bloom.strength = THREE.MathUtils.lerp(0.85, 0.28, t);
    renderer.toneMappingExposure = THREE.MathUtils.lerp(1.05, 0.95, t);
  }

  // ---------- Boucle de rendu ----------
  const clock = new THREE.Clock();
  const proj = new THREE.Vector3();
  let running = true;
  function frame() {
    if (!running) return;
    requestAnimationFrame(frame);
    const dt = Math.min(clock.getDelta(), 0.05);
    const time = clock.elapsedTime;

    tod += (todGoal - tod) * (1 - Math.exp(-dt * 0.9));
    blood += (bloodGoal - blood) * (1 - Math.exp(-dt * 0.9));
    applyTime();

    // feu qui danse
    flames.forEach((f, i) => {
      const n = Math.sin(time * 9 + f.userData.phase) * 0.5 + Math.sin(time * 13.7 + i) * 0.5;
      f.scale.set(1 + n * 0.08, 1 + n * 0.22, 1 + n * 0.08);
      f.rotation.y = time * (0.5 + i * 0.2);
    });
    fireLight.intensity = THREE.MathUtils.lerp(85, 30, tod) * (0.85 + Math.sin(time * 11) * 0.08 + Math.sin(time * 23) * 0.05);
    for (let i = 0; i < EMBERS; i++) {
      const v = emberVel[i];
      emberPos[i * 3] += v.x * dt; emberPos[i * 3 + 1] += v.y * dt; emberPos[i * 3 + 2] += v.z * dt;
      if (emberPos[i * 3 + 1] > 5.5) resetEmber(i, false);
    }
    emberGeo.attributes.position.needsUpdate = true;

    // lucioles
    flyBase.forEach((b, i) => {
      flyPos[i * 3] = b[0] + Math.sin(time * 0.6 + i) * 0.8;
      flyPos[i * 3 + 1] = b[1] + Math.sin(time * 1.3 + i * 2) * 0.3;
      flyPos[i * 3 + 2] = b[2] + Math.cos(time * 0.5 + i) * 0.8;
    });
    flyGeo.attributes.position.needsUpdate = true;

    // yeux qui clignent
    if (eyes.visible) eyes.children.forEach(e => { e.visible = Math.sin(time * 0.9 + e.userData.phase) > -0.6 && (Math.sin(time * 7 + e.userData.phase * 3) > -0.95); });

    // personnages
    for (const f of figures.values()) {
      if (!f.dead) {
        const breathe = Math.sin(time * 2 + f.phase) * 0.025;
        f.speaking = Math.max(0, f.speaking - dt);
        const talk = f.speaking > 0 ? Math.abs(Math.sin(time * 10)) * 0.06 : 0;
        f.body.position.y = breathe + talk;
        f.body.rotation.z = Math.sin(time * 0.8 + f.phase) * 0.02;
      }
      f.crown.rotation.y += dt * 0.8;
      // anneau : sélectionnable / survolé / choisi
      let target = 0;
      if (selectable?.has(f.id)) target = 0.35 + Math.sin(time * 4) * 0.12;
      if (hoverId === f.id) target = 0.75;
      if (selectedId === f.id) target = 1;
      f.ringMat.opacity += (target - f.ringMat.opacity) * Math.min(1, dt * 10);
      f.ringMat.color.set(selectedId === f.id ? '#ff5a66' : '#e9c46a').multiplyScalar(2);
      f.ring.scale.setScalar(selectedId === f.id ? 1 + Math.sin(time * 6) * 0.06 : 1);

      // étiquette HTML suit la tête
      proj.copy(f.group.position).setY(f.dead ? 1.3 : 2.45).project(camera);
      if (proj.z > 1) { f.label.style.opacity = 0; continue; }
      const x = (proj.x * 0.5 + 0.5) * container.clientWidth;
      const y = (-proj.y * 0.5 + 0.5) * container.clientHeight;
      f.label.style.opacity = 1;
      f.label.style.transform = `translate(${x}px, ${y}px) translate(-50%, -100%)`;
    }

    for (let i = effects.length - 1; i >= 0; i--) if (!effects[i].update(dt)) effects.splice(i, 1);

    if (camGoal) {
      const k = 1 - Math.exp(-dt * 2.2);
      camera.position.lerp(camGoal, k); controls.target.lerp(targetGoal, k);
      if (camera.position.distanceTo(camGoal) < 0.05) camGoal = null;
    }
    controls.update();
    if (composer) composer.render(); else renderer.render(scene, camera);
  }
  frame();

  // ---------- Redimensionnement ----------
  const ro = new ResizeObserver(() => {
    const w = container.clientWidth, h = container.clientHeight;
    renderer.setSize(w, h); composer?.setSize(w, h);
    camera.aspect = w / h; camera.updateProjectionMatrix();
  });
  ro.observe(container);

  return {
    ok: true,
    setPlayers, kill, beam, burst: (id, c) => figures.get(id) && burst(figures.get(id).group.position, c),
    voteLine, clearVoteLines, setBadge, clearBadges, showRole, hideRole, say, setMayor,
    setSelectable, setSelected, focus, resetCamera, setAutoRotate, setTimeOfDay, wolves,
    destroy() { running = false; ro.disconnect(); clearPlayers(); renderer.dispose(); renderer.domElement.remove(); },
  };
}

function makeGlowTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grd.addColorStop(0, 'rgba(255,255,255,1)'); grd.addColorStop(0.25, 'rgba(255,255,255,0.35)'); grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd; g.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
