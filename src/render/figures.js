// 两支玩具军队：每个棋子是一个木质底座（顶面印字）加一个小人偶，背后插一面写着字的小旗。
// 人偶的局部前方是 +Z；红方整体转 180° 面向黑方。
import * as THREE from "three";
import { NAMES } from "../engine/xiangqi.js";

export const DISC_R = 0.42;
export const DISC_H = 0.16;

const ARMY = {
  r: { primary: "#c0392b", dark: "#7d1f16", trim: "#f2c14e", text: "#b0221a", horse: "#8e4a2f", flag: "#d23b2f" },
  b: { primary: "#2d3e50", dark: "#141c25", trim: "#c7ced6", text: "#151515", horse: "#2b2622", flag: "#25313e" },
};
const SKIN = "#f1c9a5";
const WOOD = "#8a5a2b";

const matCache = new Map();
function mat(color, rough = 0.55, metal = 0) {
  const k = color + rough + metal;
  if (!matCache.has(k)) matCache.set(k, new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal }));
  return matCache.get(k);
}

const texCache = new Map();
function charTexture(color, type, mode) {
  const key = color + type + mode;
  if (texCache.has(key)) return texCache.get(key);
  const c = document.createElement("canvas");
  c.width = c.height = 256;
  const g = c.getContext("2d");
  const ch = NAMES[color][type];
  if (mode === "disc") {
    g.fillStyle = "#e9c88f";
    g.fillRect(0, 0, 256, 256);
    g.strokeStyle = ARMY[color].text;
    g.lineWidth = 10;
    g.beginPath();
    g.arc(128, 128, 104, 0, Math.PI * 2);
    g.stroke();
    g.fillStyle = ARMY[color].text;
  } else {
    g.fillStyle = ARMY[color].flag;
    g.fillRect(0, 0, 256, 256);
    g.strokeStyle = ARMY[color].trim;
    g.lineWidth = 14;
    g.strokeRect(10, 10, 236, 236);
    g.fillStyle = color === "r" ? "#fff2c8" : "#f2f2f2";
  }
  g.font = `bold 150px "STKaiti","Kaiti SC","KaiTi","STSong","Songti SC",serif`;
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillText(ch, 128, 138);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  texCache.set(key, t);
  return t;
}

function mesh(geo, material, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(geo, material);
  m.position.set(x, y, z);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}
const cyl = (rt, rb, h, seg = 16) => new THREE.CylinderGeometry(rt, rb, h, seg);
const sph = (r, seg = 16) => new THREE.SphereGeometry(r, seg, Math.max(8, seg * 0.75));
const box = (w, h, d) => new THREE.BoxGeometry(w, h, d);

// 一面能飘动的旗：两张背靠背的平面，各贴正字
function makeFlag(color, type, w, h) {
  const geo = new THREE.PlaneGeometry(w, h, 10, 4);
  geo.translate(w / 2, 0, 0);
  const base = geo.attributes.position.array.slice();
  const tex = charTexture(color, type, "flag");
  const m = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.8, side: THREE.FrontSide });
  // 背面：同一几何体的反面，贴左右翻转的字，从背后看也是正字
  const flipped = tex.clone();
  flipped.wrapS = THREE.RepeatWrapping;
  flipped.repeat.x = -1;
  flipped.offset.x = 1;
  flipped.needsUpdate = true;
  const front = new THREE.Mesh(geo, m);
  const back = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ map: flipped, roughness: 0.8, side: THREE.BackSide }));
  front.castShadow = true;
  const g = new THREE.Group();
  g.add(front, back);
  g.userData.flag = { geo, base, w, phase: Math.random() * 6 };
  return g;
}

function soldier(a, g) {
  g.add(mesh(cyl(0.055, 0.06, 0.2), mat(a.dark), -0.06, 0.1, 0), mesh(cyl(0.055, 0.06, 0.2), mat(a.dark), 0.06, 0.1, 0));
  g.add(mesh(cyl(0.11, 0.13, 0.28), mat(a.primary), 0, 0.33, 0));
  g.add(mesh(cyl(0.135, 0.135, 0.04), mat(a.trim, 0.4, 0.3), 0, 0.27, 0));
  g.add(mesh(sph(0.095), mat(SKIN), 0, 0.55, 0));
  g.add(mesh(new THREE.ConeGeometry(0.115, 0.12, 14), mat(a.trim, 0.4, 0.4), 0, 0.66, 0));
  const spear = new THREE.Group();
  spear.add(mesh(cyl(0.014, 0.014, 0.8, 6), mat(WOOD), 0, 0, 0));
  spear.add(mesh(new THREE.ConeGeometry(0.035, 0.12, 8), mat("#d9dde2", 0.3, 0.8), 0, 0.46, 0));
  spear.position.set(0.17, 0.42, 0.04);
  g.add(spear);
  const shield = mesh(cyl(0.12, 0.12, 0.03, 18), mat(a.trim, 0.45, 0.2), -0.15, 0.36, 0.06);
  shield.rotation.x = Math.PI / 2;
  shield.rotation.z = 0.25;
  g.add(shield);
  return { spear };
}

function general(a, g) {
  g.add(mesh(cyl(0.13, 0.19, 0.42), mat(a.primary), 0, 0.21, 0));
  g.add(mesh(new THREE.TorusGeometry(0.15, 0.022, 8, 20), mat(a.trim, 0.3, 0.6), 0, 0.3, 0)).children;
  g.children[g.children.length - 1].rotation.x = Math.PI / 2;
  const cape = mesh(new THREE.CylinderGeometry(0.2, 0.26, 0.42, 16, 1, true, Math.PI * 0.6, Math.PI * 0.8), mat(a.dark), 0, 0.22, 0);
  cape.material = cape.material.clone();
  cape.material.side = THREE.DoubleSide;
  g.add(cape);
  g.add(mesh(sph(0.12), mat(SKIN), 0, 0.53, 0));
  g.add(mesh(sph(0.13, 16), mat(a.trim, 0.3, 0.6), 0, 0.58, 0));
  g.add(mesh(new THREE.ConeGeometry(0.03, 0.18, 8), mat(a.trim, 0.3, 0.6), 0, 0.74, 0));
  g.add(mesh(sph(0.045), mat("#d4202a"), 0, 0.84, 0));
  const sword = new THREE.Group();
  sword.add(mesh(box(0.03, 0.42, 0.012), mat("#e3e7ea", 0.25, 0.9), 0, 0.2, 0));
  sword.add(mesh(box(0.12, 0.025, 0.04), mat(a.trim, 0.3, 0.6), 0, 0, 0));
  sword.position.set(0.21, 0.3, 0.08);
  sword.rotation.z = -0.25;
  g.add(sword);
  return { spear: sword };
}

function advisor(a, g) {
  g.add(mesh(cyl(0.09, 0.17, 0.42), mat(a.primary), 0, 0.21, 0));
  g.add(mesh(cyl(0.1, 0.1, 0.06), mat(a.trim, 0.4, 0.3), 0, 0.36, 0));
  g.add(mesh(sph(0.1), mat(SKIN), 0, 0.5, 0));
  g.add(mesh(box(0.2, 0.08, 0.16), mat("#141414"), 0, 0.6, 0));
  g.add(mesh(box(0.4, 0.02, 0.04), mat("#141414"), 0, 0.6, -0.04));
  const fan = mesh(new THREE.CircleGeometry(0.12, 12, 0, Math.PI), mat("#f3ead2", 0.7), 0.16, 0.38, 0.1);
  fan.material = fan.material.clone();
  fan.material.side = THREE.DoubleSide;
  g.add(fan);
  return { spear: fan };
}

function elephant(a, g) {
  const hide = mat("#9aa1a8", 0.75);
  const body = mesh(sph(0.2, 18), hide, 0, 0.38, -0.02);
  body.scale.set(1.15, 0.95, 1.4);
  g.add(body);
  for (const [x, z] of [[-0.12, 0.14], [0.12, 0.14], [-0.12, -0.18], [0.12, -0.18]]) g.add(mesh(cyl(0.06, 0.065, 0.24, 10), hide, x, 0.12, z));
  const head = mesh(sph(0.14, 16), hide, 0, 0.47, 0.27);
  g.add(head);
  for (const s of [-1, 1]) {
    const ear = mesh(new THREE.CircleGeometry(0.11, 14), hide, s * 0.14, 0.5, 0.23);
    ear.rotation.y = s * 1.1;
    ear.material = hide.clone();
    ear.material.side = THREE.DoubleSide;
    g.add(ear);
    const tusk = mesh(new THREE.ConeGeometry(0.02, 0.12, 6), mat("#f6f0dc"), s * 0.06, 0.38, 0.38);
    tusk.rotation.x = Math.PI / 2.4;
    g.add(tusk);
  }
  const trunk = mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3([new THREE.Vector3(0, 0.44, 0.38), new THREE.Vector3(0, 0.32, 0.45), new THREE.Vector3(0, 0.18, 0.44), new THREE.Vector3(0, 0.12, 0.5)]), 12, 0.035, 8), hide);
  g.add(trunk);
  const cloth = mesh(box(0.34, 0.06, 0.36), mat(a.primary), 0, 0.57, -0.04);
  g.add(cloth);
  g.add(mesh(box(0.36, 0.02, 0.38), mat(a.trim, 0.4, 0.4), 0, 0.6, -0.04));
  return { spear: trunk };
}

function horse(a, g) {
  const coat = mat(a.horse, 0.6);
  const body = mesh(cyl(0.12, 0.12, 0.42, 14), coat, 0, 0.42, -0.02);
  body.rotation.x = Math.PI / 2;
  g.add(body);
  g.add(mesh(sph(0.12, 14), coat, 0, 0.42, 0.19), mesh(sph(0.12, 14), coat, 0, 0.42, -0.23));
  const neck = mesh(cyl(0.065, 0.09, 0.3, 10), coat, 0, 0.6, 0.27);
  neck.rotation.x = 0.55;
  g.add(neck);
  const head = mesh(box(0.11, 0.12, 0.24), coat, 0, 0.74, 0.38);
  head.rotation.x = 0.35;
  g.add(head);
  g.add(mesh(box(0.03, 0.12, 0.2), mat("#1a1410"), 0, 0.72, 0.28));
  const legs = [];
  for (const [x, z] of [[-0.07, 0.16], [0.07, 0.16], [-0.07, -0.2], [0.07, -0.2]]) {
    const leg = mesh(cyl(0.032, 0.026, 0.32, 8), coat, x, 0.16, z);
    legs.push(leg);
    g.add(leg);
  }
  const tail = mesh(cyl(0.025, 0.05, 0.25, 8), mat("#1a1410"), 0, 0.38, -0.36);
  tail.rotation.x = -0.6;
  g.add(tail);
  g.add(mesh(box(0.26, 0.05, 0.22), mat(a.primary), 0, 0.55, -0.02));
  g.add(mesh(box(0.27, 0.02, 0.23), mat(a.trim, 0.4, 0.4), 0, 0.575, -0.02));
  return { legs, spear: head };
}

function chariot(a, g) {
  g.add(mesh(box(0.42, 0.08, 0.5), mat(a.primary), 0, 0.3, 0));
  g.add(mesh(box(0.44, 0.03, 0.52), mat(a.trim, 0.4, 0.4), 0, 0.35, 0));
  g.add(mesh(box(0.42, 0.2, 0.05), mat(a.dark), 0, 0.44, 0.23));
  g.add(mesh(box(0.05, 0.16, 0.42), mat(a.dark), -0.19, 0.42, 0), mesh(box(0.05, 0.16, 0.42), mat(a.dark), 0.19, 0.42, 0));
  const wheels = [];
  for (const s of [-1, 1]) {
    const w = new THREE.Group();
    const rim = mesh(new THREE.TorusGeometry(0.2, 0.025, 8, 24), mat(WOOD, 0.6), 0, 0, 0);
    w.add(rim);
    for (let i = 0; i < 4; i++) {
      const spoke = mesh(box(0.02, 0.38, 0.02), mat(WOOD, 0.6), 0, 0, 0);
      spoke.rotation.z = (i * Math.PI) / 4;
      w.add(spoke);
    }
    w.add(mesh(cyl(0.04, 0.04, 0.06, 10), mat(a.trim, 0.4, 0.5), 0, 0, 0)).children[w.children.length - 1].rotation.z = Math.PI / 2;
    w.rotation.y = Math.PI / 2;
    w.position.set(s * 0.27, 0.22, -0.02);
    g.add(w);
    wheels.push(w);
  }
  g.add(mesh(cyl(0.012, 0.012, 0.5, 6), mat(WOOD), 0, 0.6, -0.12));
  const roof = mesh(new THREE.ConeGeometry(0.26, 0.14, 16), mat(a.primary), 0, 0.86, -0.12);
  g.add(roof);
  g.add(mesh(cyl(0.1, 0.1, 0.18, 10), mat(SKIN), 0, 0.5, 0.06));
  g.add(mesh(sph(0.08), mat(SKIN), 0, 0.64, 0.06));
  g.add(mesh(new THREE.ConeGeometry(0.09, 0.1, 10), mat(a.trim, 0.4, 0.4), 0, 0.73, 0.06));
  return { wheels, spear: roof };
}

function catapult(a, g) {
  const wood = mat(WOOD, 0.65);
  for (const s of [-1, 1]) g.add(mesh(box(0.06, 0.06, 0.56), wood, s * 0.16, 0.16, 0));
  g.add(mesh(box(0.38, 0.05, 0.06), wood, 0, 0.16, 0.22), mesh(box(0.38, 0.05, 0.06), wood, 0, 0.16, -0.22));
  const wheels = [];
  for (const sx of [-1, 1])
    for (const sz of [-1, 1]) {
      const w = mesh(cyl(0.085, 0.085, 0.04, 14), mat(a.dark, 0.6), sx * 0.21, 0.09, sz * 0.18);
      w.rotation.z = Math.PI / 2;
      g.add(w);
      wheels.push(w);
    }
  for (const s of [-1, 1]) {
    const up = mesh(box(0.05, 0.42, 0.05), wood, s * 0.13, 0.38, -0.02);
    g.add(up);
  }
  g.add(mesh(box(0.32, 0.05, 0.05), mat(a.primary), 0, 0.58, -0.02));
  g.add(mesh(box(0.34, 0.03, 0.12), mat(a.trim, 0.4, 0.4), 0, 0.2, 0));
  // 投臂：绕横轴转动；勺里放一块石头
  const arm = new THREE.Group();
  arm.position.set(0, 0.5, -0.02);
  const beam = mesh(box(0.05, 0.05, 0.62), wood, 0, 0, 0.12);
  arm.add(beam);
  const bucket = mesh(sph(0.075, 12), mat(a.primary), 0, 0.03, 0.42);
  bucket.scale.y = 0.6;
  arm.add(bucket);
  const stone = mesh(sph(0.055, 10), mat("#7d7a74", 0.9), 0, 0.07, 0.42);
  arm.add(stone);
  arm.add(mesh(box(0.14, 0.14, 0.12), mat("#3c3a36", 0.8), 0, -0.04, -0.17));
  arm.rotation.x = -0.75; // 勺朝后下方，蓄力姿势
  g.add(arm);
  return { wheels, arm, stone, spear: arm };
}

const BUILDERS = { P: soldier, K: general, A: advisor, B: elephant, N: horse, R: chariot, C: catapult };

export function createFigure(code) {
  const color = code[0];
  const type = code[1];
  const a = ARMY[color];
  const root = new THREE.Group(); // 原点在底座底面中心
  const disc = new THREE.Mesh(new THREE.CylinderGeometry(DISC_R, DISC_R + 0.02, DISC_H, 40), [
    mat("#c99a5b", 0.5),
    new THREE.MeshStandardMaterial({ map: charTexture(color, type, "disc"), roughness: 0.5 }),
    mat("#c99a5b", 0.5),
  ]);
  disc.position.y = DISC_H / 2;
  disc.castShadow = disc.receiveShadow = true;
  disc.rotation.y = color === "r" ? 0 : Math.PI; // 字对着各自的主人
  root.add(disc);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(DISC_R + 0.005, 0.018, 6, 40), mat(a.trim, 0.4, 0.5));
  ring.rotation.x = Math.PI / 2;
  ring.position.y = DISC_H - 0.01;
  root.add(ring);

  const body = new THREE.Group(); // 呼吸、摇摆、攻击都作用在这一层
  body.position.y = DISC_H;
  const sway = new THREE.Group();
  body.add(sway);
  const scale = type === "K" ? 1.12 : type === "P" ? 0.92 : 1;
  sway.scale.setScalar(scale);
  const parts = BUILDERS[type](a, sway);

  // 背后插旗
  const flagH = type === "K" ? 1.08 : 0.9;
  const pole = mesh(cyl(0.012, 0.012, flagH, 6), mat(WOOD), -0.2, flagH / 2, -0.16);
  sway.add(pole);
  const fw = type === "K" ? 0.42 : 0.31, fh = type === "K" ? 0.33 : 0.25;
  const flag = makeFlag(color, type, fw, fh);
  flag.position.set(-0.2, flagH - fh / 2 - 0.02, -0.16);
  flag.rotation.y = -0.35;
  sway.add(flag);
  sway.add(mesh(sph(0.022, 8), mat(a.trim, 0.3, 0.6), -0.2, flagH + 0.01, -0.16));

  root.add(body);
  root.rotation.y = color === "r" ? Math.PI : 0;
  root.userData = { code, color, type, body, sway, parts, flag, baseYaw: root.rotation.y, phase: Math.random() * 10, wobble: new THREE.Vector2(), wobbleV: new THREE.Vector2() };
  return root;
}

// 待机：呼吸、轻摇、旗帜飘动；被碰到时摇晃一下（弹簧）
// 旗面顺风展开：风向垂直于镜头视线时，旗面正对镜头
export function flagTo(actor, dt, windYaw) {
  if (windYaw === null || windYaw === undefined) return;
  const fl = actor.userData.flag;
  let d = windYaw - actor.rotation.y - fl.rotation.y;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  fl.rotation.y += d * (1 - Math.exp(-dt * 2.5));
}

export function idle(actor, t, dt, wind = 1, windYaw = null) {
  flagTo(actor, dt, windYaw);
  const u = actor.userData;
  const s = 1 + Math.sin(t * 2.1 + u.phase) * 0.018;
  u.sway.scale.y = (u.type === "K" ? 1.12 : u.type === "P" ? 0.92 : 1) * s;
  // 摇晃弹簧
  const k = 60, c = 6;
  u.wobbleV.x += (-k * u.wobble.x - c * u.wobbleV.x) * dt;
  u.wobbleV.y += (-k * u.wobble.y - c * u.wobbleV.y) * dt;
  u.wobble.x += u.wobbleV.x * dt;
  u.wobble.y += u.wobbleV.y * dt;
  u.sway.rotation.z = Math.sin(t * 1.3 + u.phase) * 0.025 + u.wobble.x;
  u.sway.rotation.x = u.wobble.y;
  flutter(u.flag, t, wind);
}

export function flutter(flag, t, wind = 1) {
  const f = flag.userData.flag;
  const pos = f.geo.attributes.position;
  const arr = pos.array;
  for (let i = 0; i < arr.length; i += 3) {
    const x = f.base[i];
    const y = f.base[i + 1];
    const k = x / f.w;
    arr[i + 2] = f.base[i + 2] + Math.sin(x * 14 - t * 7 * wind + f.phase + y * 3) * 0.035 * k * wind;
    arr[i + 1] = y - k * k * 0.02;
  }
  pos.needsUpdate = true;
  f.geo.computeVertexNormals();
}
