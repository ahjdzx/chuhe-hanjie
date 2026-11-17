/**
 * [INPUT]: 依赖 three 与 OrbitControls；读取演出层给的 focus（只读）和相机当前的视野、宽高比
 * [OUTPUT]: 导出 Director（setMode 三种模式 auto/free/top、update、obstacles 回调、onUserTakeover 回调）
 * [POS]: render 的摄影师。演出层只说「现在发生什么」（focus），机位怎么摆由它决定；用临界阻尼弹簧平滑推拉。
 *        机位是照 16:10 横屏调的；竖屏时俯视按屏宽算高度，待机只在红方身后左右摆，跟拍沿视线拉远。
 * [PROTOCOL]: Update this header on change, then check CLAUDE.md
 */
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

// 俯视：高度按画面算，刚好装下。纵向连上下界面留的边一起装（横屏下与原先固定的 19 高相同）；横向在宽屏上连两侧托盘一起装，竖屏上只保棋盘
const TOP = { depth: 13.1, wide: 17.4, narrow: 10.2, lean: 0.105, look: new THREE.Vector3(0, 0, 0.2) };
const WIDE = Math.tan((19 * Math.PI) / 180) * 1.6; // 调机位时（16:10、38° 视野）水平半视角的正切

class Spring3 {
  constructor(v) {
    this.x = v.clone();
    this.v = new THREE.Vector3();
  }
  step(target, dt, time) {
    const w = 1 / time;
    const a = target.clone().sub(this.x).multiplyScalar(w * w).addScaledVector(this.v, -2 * w);
    this.v.addScaledVector(a, dt);
    this.x.addScaledVector(this.v, dt);
    return this.x;
  }
  snap(v) {
    this.x.copy(v);
    this.v.set(0, 0, 0);
  }
}

export class Director {
  constructor(camera, dom) {
    this.camera = camera;
    this.mode = "auto";
    this.eye = new Spring3(new THREE.Vector3(0, 13, 13));
    this.look = new Spring3(new THREE.Vector3(0, 0, 0));
    this.orbit = 0.6;
    this.shot = "wide";
    this.shotAge = 0;
    this.controls = new OrbitControls(camera, dom);
    this.controls.enableDamping = true;
    this.controls.maxPolarAngle = Math.PI * 0.47;
    this.controls.minDistance = 4;
    this.controls.maxDistance = 30;
    this.controls.enabled = false;
    this.onUserTakeover = null;
    dom.addEventListener("pointerdown", (e) => {
      if (this.mode === "auto" && e.button === 2) this.setMode("free");
    });
    dom.addEventListener("wheel", () => {
      if (this.mode === "auto") this.setMode("free");
    });
    // 触屏没有右键和滚轮：双指一碰就交给自由视角（单指留给点棋子）
    dom.addEventListener("touchstart", (e) => {
      if (this.mode === "auto" && e.touches.length >= 2) this.setMode("free");
    }, { passive: true });
  }

  setMode(mode) {
    this.mode = mode;
    this.controls.enabled = mode === "free";
    if (mode === "free") {
      this.controls.target.copy(this.look.x);
      this.camera.position.copy(this.eye.x);
    }
    this.onUserTakeover?.(mode);
  }

  // 机位求解：在主体周围 24 个方位里挑一个——不出桌面、视线不被棋子挡、构图合适、尽量少转
  solve(subject, { dist, elev, prefer = null, sideways = false, weight = 4, exclude = [] }) {
    const here = this.eye.x.clone().sub(subject).setY(0);
    const hereAz = Math.atan2(here.x, here.z);
    const obstacles = (this.obstacles?.() || []).filter((a) => !exclude.includes(a));
    let best = null;
    for (let k = 0; k < 24; k++) {
      const az = (k / 24) * Math.PI * 2;
      const dir = new THREE.Vector3(Math.sin(az), 0, Math.cos(az));
      const eye = subject.clone().addScaledVector(dir, dist * Math.cos(elev)).setY(subject.y + dist * Math.sin(elev));
      let score = 0;
      // 出界
      const ex = Math.max(0, Math.abs(eye.x) - 10) + Math.max(0, Math.abs(eye.z) - 11.5);
      score += ex * 40;
      // 遮挡：视线上有别的棋子
      for (const o of obstacles) {
        for (let i = 2; i < 12; i++) {
          const p = subject.clone().lerp(eye, i / 12);
          if (p.y > o.position.y + 1.05) break;
          if (Math.hypot(p.x - o.position.x, p.z - o.position.z) < 0.5) {
            score += 5;
            break;
          }
        }
      }
      // 构图偏好
      if (prefer) {
        const d = dir.dot(prefer);
        score += (sideways ? Math.abs(d) : 1 - d) * weight;
      }
      // 连续性：少转动
      let turn = Math.abs(az - hereAz) % (Math.PI * 2);
      if (turn > Math.PI) turn = Math.PI * 2 - turn;
      score += turn * 1.5;
      if (!best || score < best.score) best = { score, eye, dir, az };
    }
    return best;
  }

  // 事件变化时重新定镜；离当前机位太远就直接切过去
  frame(f) {
    const up = new THREE.Vector3(0, 0.45, 0);
    if (f.kind === "move" && f.actor) {
      const dir = f.to.clone().sub(f.from).setY(0);
      if (dir.lengthSq() < 1e-4) dir.set(0, 0, -1);
      dir.normalize();
      const span = f.from.distanceTo(f.to);
      const mid = f.from.clone().lerp(f.to, 0.5);
      const side = new THREE.Vector3(-dir.z, 0, dir.x);
      const prefer = dir.clone().multiplyScalar(-1).addScaledVector(side, 0.7).normalize();
      const shot = this.solve(mid, { dist: 8.6 + span * 0.35, elev: 0.74, prefer, exclude: [f.actor] });
      return { offset: shot.eye.clone().sub(mid), follow: f.actor, lead: dir, time: 0.7, base: mid };
    }
    if ((f.kind === "attack" || f.kind === "fire") && f.at) {
      const mid = f.kind === "fire" ? f.from.clone().lerp(f.at, 0.5) : f.at.clone();
      const span = f.kind === "fire" ? f.from.distanceTo(f.at) : 0;
      const shot = this.solve(mid, { dist: f.kind === "fire" ? Math.max(8, span * 0.95 + 5) : 6.6, elev: f.kind === "fire" ? 0.66 : 0.6, prefer: f.dir, sideways: true, weight: 6, exclude: [f.actor, f.target] });
      return { eye: shot.eye, look: mid.clone().add(up), time: 0.45, stone: f.kind === "fire" };
    }
    if (f.kind === "check" && f.king) {
      // 将军：把将军的子和被将的将帅一起框进来，从高处越过中间的棋子
      const k = f.king.clone();
      const mid = k.clone().lerp(f.at, 0.5);
      const span = k.distanceTo(f.at);
      const toCenter = new THREE.Vector3(-k.x, 0, -k.z).normalize();
      const shot = this.solve(mid, { dist: 7.2 + span * 0.9, elev: 0.86, prefer: toCenter, weight: 4, exclude: [f.actor] });
      return { eye: shot.eye, look: mid.clone().add(up), time: 0.8 };
    }
    return null;
  }

  // 每帧：按当前镜头推拉
  update(dt, focus, playing) {
    if (this.mode === "free") {
      this.controls.update();
      this.eye.snap(this.camera.position);
      this.look.snap(this.controls.target);
      return;
    }
    let eye, look, time = 1.1;
    // 水平、垂直半视角的正切。竖屏比调机位时窄：跟拍和特写沿视线拉远一些（封顶 1.25 倍），免得主体挤出画面
    const tanV = Math.tan((this.camera.fov * Math.PI) / 360), tanH = tanV * this.camera.aspect;
    const pullBack = Math.min(1.25, Math.max(1, WIDE / tanH));
    let pull = 1;
    if (this.mode === "top") {
      const height = Math.max(TOP.depth / (2 * tanV), (this.camera.aspect > 1 ? TOP.wide : TOP.narrow) / (2 * tanH));
      eye = new THREE.Vector3(0, height, TOP.look.z + height * TOP.lean);
      look = TOP.look;
      time = 0.6;
    } else {
      this.orbit += dt * (playing ? 0.05 : 0.12);
      const f = focus || { kind: "idle" };
      if (f !== this.lastFocus) {
        this.lastFocus = f;
        this.current = this.frame(f);
        if (this.current) {
          const want = this.current.eye || this.current.base.clone().add(this.current.offset);
          if (want.distanceTo(this.eye.x) > 9) {
            // 切镜：像剪辑一样直接跳到新机位
            this.eye.snap(want);
            this.look.snap(this.current.look || this.current.base);
          }
        }
      }
      const c = this.current;
      if (c && c.follow) {
        const p = c.follow.position.clone().setY(0);
        const anchor = c.base.clone().lerp(p, 0.6);
        eye = anchor.clone().add(c.offset);
        look = anchor.clone().addScaledVector(c.lead, 0.6).add(new THREE.Vector3(0, 0.35, 0));
        time = c.time;
        pull = pullBack;
      } else if (c && c.eye) {
        eye = c.eye;
        look = c.stone && f.stone ? c.look.clone().lerp(f.stone, 0.3) : c.look;
        time = c.time;
        pull = pullBack;
      } else if (f.kind === "over" && f.at) {
        const r = 6;
        eye = new THREE.Vector3(f.at.x + Math.sin(this.orbit * 3) * r, 4.2, f.at.z + Math.cos(this.orbit * 3) * r);
        look = f.at.clone().add(new THREE.Vector3(0, 0.5, 0));
        time = 1.2;
      } else {
        // 横屏绕桌一圈；竖屏只在红方身后左右摆：转到侧面，棋盘就只剩一小条
        const r = 13.5;
        const az = this.camera.aspect < 1 ? Math.sin(this.orbit) * 0.5 : this.orbit;
        eye = new THREE.Vector3(Math.sin(az) * r * 0.55, 11.5, Math.cos(az) * r);
        look = new THREE.Vector3(0, 0, 0);
        time = f.kind === "settle" ? 1.6 : 1.3;
      }
      // 机位始终留在桌面上空，并保持足够的俯角
      eye = look.clone().addScaledVector(eye.clone().sub(look), pull);
      eye.x = Math.max(-10.5, Math.min(10.5, eye.x));
      eye.z = Math.max(-12, Math.min(12, eye.z));
      const horiz = Math.hypot(eye.x - look.x, eye.z - look.z);
      eye.y = Math.max(eye.y, look.y + horiz * 0.5, 3);
      // 被夹回桌面范围后若离看点太近，就沿视线往后、往上退
      const away = eye.clone().sub(look);
      if (away.length() < 5.5) eye.copy(look).addScaledVector(away.normalize(), 5.5);
    }
    this.camera.position.copy(this.eye.step(eye, dt, time));
    this.camera.lookAt(this.look.step(look, dt, time * 0.8));
  }
}
