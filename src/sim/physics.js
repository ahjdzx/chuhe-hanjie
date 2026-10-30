// 轻量刚体：只给被吃掉的棋子用。点采样碰撞（底座边缘、头顶、旗杆顶）对地面、桌沿和站着的棋子，
// 冲量法处理弹跳和摩擦，速度够小就静止。它只负责「倒得像」，从不改变对局状态。
import * as THREE from "three";
import { groundAt, TABLE } from "../render/world.js";

export const GRAVITY = 14;
const REST = 0.32;
const MU = 0.55;
const INV_I = 1 / 0.05;
const COM = new THREE.Vector3(0, 0.34, 0); // 质心相对底座底面

// 局部采样点：底座下沿一圈 + 底座上沿 + 人偶头顶 + 旗杆顶
const SAMPLES = [];
for (let i = 0; i < 10; i++) {
  const a = (i / 10) * Math.PI * 2;
  SAMPLES.push(new THREE.Vector3(Math.cos(a) * 0.42, 0, Math.sin(a) * 0.42));
  SAMPLES.push(new THREE.Vector3(Math.cos(a) * 0.42, 0.16, Math.sin(a) * 0.42));
}
SAMPLES.push(new THREE.Vector3(0, 0.82, 0), new THREE.Vector3(0.15, 0.6, 0.15), new THREE.Vector3(-0.15, 0.6, -0.15), new THREE.Vector3(-0.2, 0.92, -0.16));

const tmp = new THREE.Vector3();
const r = new THREE.Vector3();
const vp = new THREE.Vector3();
const n = new THREE.Vector3();
const rxn = new THREE.Vector3();

export class Body {
  constructor(actor, velocity, spin) {
    this.actor = actor;
    this.q = actor.quaternion.clone();
    this.x = actor.position.clone().add(COM.clone().applyQuaternion(this.q));
    this.v = velocity.clone();
    this.w = spin.clone();
    this.sleep = 0;
    this.asleep = false;
    this.age = 0;
  }
  sync() {
    this.actor.quaternion.copy(this.q);
    this.actor.position.copy(this.x).sub(tmp.copy(COM).applyQuaternion(this.q));
  }
  // 冲量施加在 offset 处（相对质心），方向 dir，大小 j
  impulse(offset, dir, j) {
    this.v.addScaledVector(dir, j);
    this.w.addScaledVector(rxn.copy(offset).cross(dir), j * INV_I);
  }
  // 在接触点沿法线 normal 解碰撞
  contact(world, normal, depth) {
    r.copy(world).sub(this.x);
    vp.copy(this.w).cross(r).add(this.v);
    const vn = vp.dot(normal);
    this.x.addScaledVector(normal, depth * 0.8);
    if (vn >= 0) return 0;
    rxn.copy(r).cross(normal);
    const k = 1 + rxn.lengthSq() * INV_I;
    const j = (-(1 + REST) * vn) / k;
    this.impulse(r, normal, j);
    // 摩擦
    vp.copy(this.w).cross(r).add(this.v);
    const vt = tmp.copy(vp).addScaledVector(normal, -vp.dot(normal));
    const speed = vt.length();
    if (speed > 1e-5) {
      vt.multiplyScalar(1 / speed);
      rxn.copy(r).cross(vt);
      const kt = 1 + rxn.lengthSq() * INV_I;
      const jt = Math.min(speed / kt, MU * j);
      this.impulse(r, vt.clone().negate(), jt);
    }
    return -vn;
  }
}

export class World {
  constructor() {
    this.bodies = [];
    this.standing = []; // [{ position: Vector3(底面中心), actor }]
  }
  add(body) {
    this.bodies.push(body);
    return body;
  }
  remove(body) {
    this.bodies = this.bodies.filter((b) => b !== body);
  }
  step(dt) {
    const sub = 4;
    const h = dt / sub;
    for (let s = 0; s < sub; s++) for (const b of this.bodies) if (!b.asleep) this.integrate(b, h);
    // 身体之间：用质心球互相推开
    for (let i = 0; i < this.bodies.length; i++)
      for (let j = i + 1; j < this.bodies.length; j++) {
        const a = this.bodies[i], c = this.bodies[j];
        tmp.copy(c.x).sub(a.x);
        const d = tmp.length();
        if (d > 0 && d < 0.6) {
          n.copy(tmp).multiplyScalar(1 / d);
          const push = (0.6 - d) / 2;
          a.x.addScaledVector(n, -push);
          c.x.addScaledVector(n, push);
          const rel = c.v.clone().sub(a.v).dot(n);
          if (rel < 0) {
            a.v.addScaledVector(n, rel * 0.6);
            c.v.addScaledVector(n, -rel * 0.6);
          }
          a.asleep = c.asleep = false;
        }
      }
    for (const b of this.bodies) b.sync();
  }
  integrate(b, h) {
    b.age += h;
    b.v.y -= GRAVITY * h;
    b.x.addScaledVector(b.v, h);
    // 旋转积分
    const wl = b.w.length();
    if (wl > 1e-6) {
      const dq = new THREE.Quaternion().setFromAxisAngle(tmp.copy(b.w).multiplyScalar(1 / wl), wl * h);
      b.q.premultiply(dq).normalize();
    }
    b.v.multiplyScalar(1 - 0.15 * h);
    b.w.multiplyScalar(1 - 0.6 * h);
    let touching = false;
    for (const local of SAMPLES) {
      const p = tmp.copy(local).sub(COM).applyQuaternion(b.q).add(b.x);
      const world = p.clone();
      // 地面（棋盘面或桌面）
      const g = groundAt(world.x, world.z);
      if (world.y < g) {
        touching = true;
        b.contact(world, n.set(0, 1, 0), g - world.y);
      }
      // 桌沿
      if (Math.abs(world.x) > TABLE.rimX) {
        b.contact(world, n.set(-Math.sign(world.x), 0, 0), Math.abs(world.x) - TABLE.rimX);
      }
      if (Math.abs(world.z) > TABLE.rimZ) {
        b.contact(world, n.set(0, 0, -Math.sign(world.z)), Math.abs(world.z) - TABLE.rimZ);
      }
      // 站着的棋子：竖直圆柱 r = 0.44，高 0.95
      for (const s of this.standing) {
        const dx = world.x - s.position.x;
        const dz = world.z - s.position.z;
        const d2 = dx * dx + dz * dz;
        if (d2 < 0.44 * 0.44 && world.y < s.position.y + 0.95 && world.y > s.position.y - 0.05) {
          const d = Math.sqrt(d2) || 1e-3;
          n.set(dx / d, 0, dz / d);
          const hit = b.contact(world, n, 0.44 - d);
          if (hit > 0.3 && s.actor) {
            // 被撞到的棋子晃一下，但不会被撞离格子
            const u = s.actor.userData;
            u.wobbleV.x += -n.x * hit * 0.35;
            u.wobbleV.y += n.z * hit * 0.35;
          }
        }
      }
    }
    // 静止判定
    if (touching && b.v.lengthSq() < 0.02 && b.w.lengthSq() < 0.05) {
      b.sleep += h;
      if (b.sleep > 0.35) {
        b.asleep = true;
        b.v.set(0, 0, 0);
        b.w.set(0, 0, 0);
      }
    } else b.sleep = 0;
  }
}

// 抛体：给定起点、终点和必须越过的最高点，算发射速度与飞行时间（真实重力下）
export function ballistic(p0, p1, apex, g = GRAVITY) {
  const H = Math.max(apex, p0.y + 0.05, p1.y + 0.05);
  const vy = Math.sqrt(2 * g * (H - p0.y));
  const tUp = vy / g;
  const tDown = Math.sqrt((2 * (H - p1.y)) / g);
  const T = tUp + tDown;
  const v = new THREE.Vector3((p1.x - p0.x) / T, vy, (p1.z - p0.z) / T);
  const angle = (Math.atan2(vy, Math.hypot(v.x, v.z)) * 180) / Math.PI;
  return { v, T, angle, apex: H };
}
