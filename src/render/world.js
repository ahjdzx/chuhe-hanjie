// 场景：低矮漆木桌、真实棋盘、两侧收子托盘、灯光。只负责「看起来」，不碰对局状态。
import * as THREE from "three";

export const BOARD_W = 9.6; // x: -4.8 .. 4.8
export const BOARD_D = 10.6; // z: -5.3 .. 5.3
export const BOARD_T = 0.3; // 棋盘厚度：棋盘面 y = 0，桌面 y = -0.3
export const TABLE = { w: 18, d: 14, top: -BOARD_T, rimX: 8.6, rimZ: 6.6 };
export const TRAY_X = 7.1;

// 棋盘坐标 → 世界坐标。红方在近处（+z），x 为列。
export const toWorld = (x, y) => new THREE.Vector3(x - 4, 0, 4.5 - y);
export const fromWorld = (v) => [Math.round(v.x + 4), Math.round(4.5 - v.z)];

export function groundAt(x, z) {
  if (Math.abs(x) <= BOARD_W / 2 && Math.abs(z) <= BOARD_D / 2) return 0;
  return TABLE.top;
}

function boardTexture() {
  const S = 110;
  const c = document.createElement("canvas");
  c.width = Math.round(BOARD_W * S);
  c.height = Math.round(BOARD_D * S);
  const g = c.getContext("2d");
  // 木纹
  const grad = g.createLinearGradient(0, 0, c.width, c.height);
  grad.addColorStop(0, "#e2b878");
  grad.addColorStop(1, "#d3a463");
  g.fillStyle = grad;
  g.fillRect(0, 0, c.width, c.height);
  for (let i = 0; i < 140; i++) {
    g.strokeStyle = `rgba(120,70,30,${0.03 + Math.random() * 0.05})`;
    g.lineWidth = 1 + Math.random() * 2.5;
    g.beginPath();
    const y0 = Math.random() * c.height;
    g.moveTo(0, y0);
    for (let x = 0; x <= c.width; x += 40) g.lineTo(x, y0 + Math.sin(x / 90 + i) * 6 + Math.random() * 2);
    g.stroke();
  }
  const px = (x) => (x + BOARD_W / 2) * S;
  const pz = (z) => (z + BOARD_D / 2) * S;
  const P = (bx, by) => [px(bx - 4), pz(4.5 - by)];
  g.strokeStyle = "#5a2d12";
  g.lineCap = "round";
  // 外框（双线）
  g.lineWidth = 7;
  g.strokeRect(px(-4.22), pz(-4.72), 8.44 * S, 9.44 * S);
  g.lineWidth = 3;
  const line = (a, b) => {
    g.beginPath();
    g.moveTo(...P(...a));
    g.lineTo(...P(...b));
    g.stroke();
  };
  for (let y = 0; y < 10; y++) line([0, y], [8, y]);
  for (let x = 0; x < 9; x++) {
    if (x === 0 || x === 8) line([x, 0], [x, 9]);
    else {
      line([x, 0], [x, 4]);
      line([x, 5], [x, 9]);
    }
  }
  // 九宫斜线
  line([3, 0], [5, 2]);
  line([5, 0], [3, 2]);
  line([3, 7], [5, 9]);
  line([5, 7], [3, 9]);
  // 炮位、兵位的花标
  const mark = (bx, by) => {
    const [cx, cy] = P(bx, by);
    const d = 9, l = 22;
    for (const [sx, sy] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
      if ((bx === 0 && sx < 0) || (bx === 8 && sx > 0)) continue;
      g.beginPath();
      g.moveTo(cx + sx * d, cy + sy * (d + l));
      g.lineTo(cx + sx * d, cy + sy * d);
      g.lineTo(cx + sx * (d + l), cy + sy * d);
      g.stroke();
    }
  };
  for (const x of [1, 7]) {
    mark(x, 2);
    mark(x, 7);
  }
  for (const x of [0, 2, 4, 6, 8]) {
    mark(x, 3);
    mark(x, 6);
  }
  // 楚河 漢界
  g.fillStyle = "#5a2d12";
  g.font = `bold ${Math.round(S * 0.62)}px "STKaiti","Kaiti SC","KaiTi","STSong",serif`;
  g.textAlign = "center";
  g.textBaseline = "middle";
  const ry = pz(0);
  g.save();
  g.translate(px(-2), ry);
  g.rotate(Math.PI / 2);
  g.restore();
  g.fillText("楚  河", px(-2), ry);
  g.save();
  g.translate(px(2), ry);
  g.rotate(Math.PI);
  g.fillText("漢  界", 0, 0);
  g.restore();
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

function lacquer(color, rough = 0.32) {
  return new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: 0.05 });
}

export function createWorld(canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color("#1b1714");
  scene.fog = new THREE.Fog("#1b1714", 30, 60);

  const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 200);
  camera.position.set(0, 13, 14);
  camera.lookAt(0, 0, 0);

  // 灯光：暖色主光带阴影，冷色补光，天光
  scene.add(new THREE.HemisphereLight("#fff4e0", "#3a2a20", 0.85));
  const key = new THREE.DirectionalLight("#ffe2b8", 2.4);
  key.position.set(-7, 16, 9);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  const sc = key.shadow.camera;
  sc.left = -11;
  sc.right = 11;
  sc.top = 11;
  sc.bottom = -11;
  sc.near = 1;
  sc.far = 45;
  key.shadow.bias = -0.0004;
  key.shadow.normalBias = 0.02;
  scene.add(key);
  const fill = new THREE.DirectionalLight("#9fc4ff", 0.45);
  fill.position.set(9, 7, -8);
  scene.add(fill);

  // 地面（榻榻米色），桌子
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(120, 120), new THREE.MeshStandardMaterial({ color: "#3b3127", roughness: 0.95 }));
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -2.2;
  floor.receiveShadow = true;
  scene.add(floor);

  const table = new THREE.Group();
  const topMat = lacquer("#5a1d14", 0.28);
  const edgeMat = lacquer("#2a0d08", 0.35);
  const top = new THREE.Mesh(new THREE.BoxGeometry(TABLE.w, 0.4, TABLE.d), topMat);
  top.position.y = TABLE.top - 0.2;
  top.receiveShadow = true;
  top.castShadow = true;
  table.add(top);
  // 桌沿凸起的边
  const rimH = 0.12;
  for (const [w, d, x, z] of [
    [TABLE.w, 0.18, 0, TABLE.d / 2 - 0.09],
    [TABLE.w, 0.18, 0, -TABLE.d / 2 + 0.09],
    [0.18, TABLE.d, TABLE.w / 2 - 0.09, 0],
    [0.18, TABLE.d, -TABLE.w / 2 + 0.09, 0],
  ]) {
    const rim = new THREE.Mesh(new THREE.BoxGeometry(w, rimH, d), edgeMat);
    rim.position.set(x, TABLE.top + rimH / 2, z);
    rim.castShadow = rim.receiveShadow = true;
    table.add(rim);
  }
  // 束腰与短腿
  const apron = new THREE.Mesh(new THREE.BoxGeometry(TABLE.w - 1, 0.5, TABLE.d - 1), edgeMat);
  apron.position.y = TABLE.top - 0.65;
  table.add(apron);
  for (const sx of [-1, 1])
    for (const sz of [-1, 1]) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.6, 1.4, 0.6), edgeMat);
      leg.position.set(sx * (TABLE.w / 2 - 0.9), TABLE.top - 1.3, sz * (TABLE.d / 2 - 0.9));
      leg.castShadow = true;
      table.add(leg);
      const foot = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.12, 0.9), lacquer("#c9a24a", 0.4));
      foot.position.set(sx * (TABLE.w / 2 - 0.9), -2.14, sz * (TABLE.d / 2 - 0.9));
      table.add(foot);
    }
  scene.add(table);

  // 棋盘：木块，顶面贴棋盘纹
  const boardTop = new THREE.MeshStandardMaterial({ map: boardTexture(), roughness: 0.6 });
  const boardSide = new THREE.MeshStandardMaterial({ color: "#b98446", roughness: 0.55 });
  const board = new THREE.Mesh(new THREE.BoxGeometry(BOARD_W, BOARD_T, BOARD_D), [boardSide, boardSide, boardTop, boardSide, boardSide, boardSide]);
  board.position.y = -BOARD_T / 2;
  board.receiveShadow = true;
  board.castShadow = true;
  scene.add(board);

  // 两侧托盘：左边收红方被吃的子，右边收黑方被吃的子
  const trays = {};
  for (const [color, x] of [["r", -TRAY_X], ["b", TRAY_X]]) {
    const g = new THREE.Group();
    const base = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.08, 6), lacquer(color === "r" ? "#6d2418" : "#1e262f", 0.4));
    base.position.y = TABLE.top + 0.04;
    base.receiveShadow = true;
    g.add(base);
    const wallMat = lacquer("#c9a24a", 0.35);
    for (const [w, d, ox, oz] of [[2.2, 0.08, 0, 2.96], [2.2, 0.08, 0, -2.96], [0.08, 6, 1.06, 0], [0.08, 6, -1.06, 0]]) {
      const wall = new THREE.Mesh(new THREE.BoxGeometry(w, 0.22, d), wallMat);
      wall.position.set(ox, TABLE.top + 0.15, oz);
      wall.castShadow = true;
      g.add(wall);
    }
    g.position.x = x;
    scene.add(g);
    trays[color] = { group: g, x, count: 0 };
  }

  // 选子用的透明平面
  const pickPlane = new THREE.Mesh(new THREE.PlaneGeometry(BOARD_W, BOARD_D), new THREE.MeshBasicMaterial({ visible: false }));
  pickPlane.rotation.x = -Math.PI / 2;
  pickPlane.position.y = 0.01;
  scene.add(pickPlane);

  return { renderer, scene, camera, trays, pickPlane, key };
}

// 托盘里的第 i 个位置（4 列 × 4 行，缩小摆放）
export function traySlot(tray, i) {
  const col = i % 3;
  const row = Math.floor(i / 3);
  return new THREE.Vector3(tray.x + (col - 1) * 0.62, TABLE.top + 0.08, -2.5 + row * 0.85);
}
