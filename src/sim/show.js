// 演出层：把引擎已经决定的一步棋演出来。只读走法记录，从不改变对局状态。
// 每一步是一个协程（生成器），由 update(dt) 推进；暂停时 dt 为 0，一切静止。
import * as THREE from "three";
import { fileOf, rankOf } from "../engine/xiangqi.js";
import { toWorld, traySlot } from "../render/world.js";
import { createFigure, idle, flagTo, flutter } from "../render/figures.js";
import { Body, World, ballistic, GRAVITY } from "./physics.js";
import { Effects } from "./fx.js";

const ease = (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
const clamp01 = (t) => Math.min(1, Math.max(0, t));
function* wait(sec) {
  let e = 0;
  while (e < sec) e += yield;
}
function* tween(sec, fn) {
  let e = 0;
  fn(0);
  while (e < sec) {
    e += yield;
    fn(clamp01(e / sec));
  }
}
const yawTo = (dir) => Math.atan2(dir.x, dir.z);
function shortestYaw(from, to) {
  let d = to - from;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return from + d;
}

const SPEED = { R: 3.2, C: 2.4, N: 2.2, B: 1.5, A: 1.3, K: 1.2, P: 1.1 };
const CLEAR = 0.88; // 两个底座中心的最小距离（半径 0.42 × 2 + 余量）

export class Stage {
  constructor(scene, camera, trays, rng) {
    this.scene = scene;
    this.trays = trays;
    this.fx = new Effects(scene, camera);
    this.world = new World();
    this.actors = new Map(); // 格子 → 人偶
    this.loose = []; // 正在倒地或被移走的
    this.tasks = [];
    this.rng = rng;
    this.focus = { kind: "idle" };
    this.listeners = [];
    this.time = 0;
    this.wind = 1;
    this.windYaw = null;
    this.movers = new Set();
  }

  on(fn) {
    this.listeners.push(fn);
  }
  emit(ev) {
    for (const fn of this.listeners) fn(ev);
  }

  reset(board, rng) {
    if (rng) this.rng = rng;
    for (const a of this.actors.values()) this.scene.remove(a);
    for (const l of this.loose) this.scene.remove(l.actor);
    for (const t of Object.values(this.trays)) {
      for (const a of t.pieces || []) this.scene.remove(a);
      t.pieces = [];
      t.count = 0;
    }
    this.actors.clear();
    this.loose = [];
    this.tasks = [];
    this.world = new World();
    this.fx.clear();
    for (let s = 0; s < board.length; s++) {
      if (!board[s]) continue;
      const a = createFigure(board[s]);
      a.position.copy(toWorld(fileOf(s), rankOf(s)));
      a.userData.home = a.position.clone();
      a.userData.offset = new THREE.Vector3();
      this.scene.add(a);
      this.actors.set(s, a);
    }
    this.focus = { kind: "idle" };
  }

  run(gen, done) {
    gen.next();
    this.tasks.push({ gen, done });
  }

  get busy() {
    return this.tasks.length > 0;
  }

  update(dt) {
    this.time += dt;
    for (const task of this.tasks.slice()) {
      const r = task.gen.next(dt);
      if (r.done) {
        this.tasks.splice(this.tasks.indexOf(task), 1);
        task.done?.(r.value);
      }
    }
    this.world.standing = [...this.actors.values()].filter((a) => !a.userData.moving).map((a) => ({ position: a.position, actor: a }));
    if (dt > 0) this.world.step(dt);
    for (const a of this.actors.values()) {
      if (dt > 0) idle(a, this.time, dt, this.wind, this.windYaw);
      // 给路过的棋子让位后，弹回原位
      const u = a.userData;
      if (!u.moving && u.home) {
        u.offset.multiplyScalar(Math.exp(-dt * 5));
        a.position.copy(u.home).add(u.offset);
      }
      if (u.march > 0) {
        u.march = Math.max(0, u.march - dt * 0.6);
        u.body.position.y = 0.16 + Math.abs(Math.sin(this.time * 9 + u.phase)) * 0.04 * u.march;
      }
    }
    // 正在走的棋子旗子也照常飘
    if (dt > 0)
      for (const a of this.movers) {
        flagTo(a, dt, this.windYaw);
        flutter(a.userData.flag, this.time, this.wind);
      }
    this.fx.update(dt);
  }

  // ---- 一步棋的演出 -------------------------------------------------------------------
  perform(entry) {
    return new Promise((resolve) => this.run(this.moveShow(entry), resolve));
  }

  *moveShow(entry) {
    const actor = this.actors.get(entry.from);
    if (!actor) return;
    const target = entry.captured ? this.actors.get(entry.to) : null;
    this.actors.delete(entry.from);
    const type = entry.piece[1];
    const start = toWorld(fileOf(entry.from), rankOf(entry.from));
    const end = toWorld(fileOf(entry.to), rankOf(entry.to));
    const u = actor.userData;
    u.moving = true;
    this.movers.add(actor);
    this.focus = { kind: "move", actor, from: start, to: end, capture: !!target, type };
    this.emit({ type: "move-start", entry, actor });

    if (target) {
      this.actors.delete(entry.to);
      if (type === "C") yield* this.cannonCapture(actor, target, start, end, entry);
      else yield* this.meleeCapture(actor, target, start, end, type);
    } else {
      yield* this.travel(actor, this.route(start, end, type, actor), type);
    }
    // 回正朝向
    const forwardYaw = u.baseYaw;
    const y0 = actor.rotation.y;
    const y1 = shortestYaw(y0, forwardYaw);
    yield* tween(0.25, (t) => (actor.rotation.y = y0 + (y1 - y0) * ease(t)));
    actor.position.copy(end);
    u.home = end.clone();
    u.offset.set(0, 0, 0);
    u.moving = false;
    this.movers.delete(actor);
    this.actors.set(entry.to, actor);
    let king = null;
    if (entry.check) for (const o of this.actors.values()) if (o.userData.code === (entry.side === "r" ? "b" : "r") + "K") king = o.position.clone();
    this.focus = { kind: entry.check && king ? "check" : "settle", actor, at: end, check: entry.check, king };
    this.emit({ type: "move-end", entry, actor });
    // 等被吃的子倒地并被收走
    while (this.loose.length) yield;
  }

  // 路线：直线；若会穿过别的棋子（炮隔子吃时的炮架），从旁边绕过去
  route(a, b, type, self, ignore = []) {
    if (type === "N") return [a, b];
    const dir = b.clone().sub(a);
    const len = dir.length();
    dir.normalize();
    const side = new THREE.Vector3(-dir.z, 0, dir.x);
    let blocker = null;
    for (const o of this.actors.values()) {
      if (o === self || ignore.includes(o)) continue;
      const rel = o.position.clone().sub(a);
      const along = rel.dot(dir);
      if (along < 0.3 || along > len - 0.3) continue;
      if (Math.abs(rel.dot(side)) < 0.5) {
        blocker = { o, along };
        break;
      }
    }
    if (!blocker) return [a, b];
    // 选空的一侧
    const crowd = (s) => [...this.actors.values()].filter((o) => o.position.distanceTo(blocker.o.position.clone().addScaledVector(side, s * 0.6)) < 0.7).length;
    const s = crowd(1) <= crowd(-1) ? 1 : -1;
    const p1 = a.clone().addScaledVector(dir, blocker.along - 0.75).addScaledVector(side, s * 0.62);
    const p2 = a.clone().addScaledVector(dir, blocker.along + 0.75).addScaledVector(side, s * 0.62);
    return [a, p1, p2, b];
  }

  *travel(actor, pts, type) {
    const u = actor.userData;
    const curve = pts.length > 2 ? new THREE.CatmullRomCurve3(pts, false, "centripetal") : new THREE.LineCurve3(pts[0], pts[1]);
    const length = curve.getLength();
    const dur = Math.max(0.45, length / SPEED[type] + (type === "N" ? 0.25 : 0));
    const yawStart = actor.rotation.y;
    const first = pts[1].clone().sub(pts[0]);
    const yawGoal = shortestYaw(yawStart, yawTo(first));
    // 先转身
    yield* tween(0.22, (t) => (actor.rotation.y = yawStart + (yawGoal - yawStart) * ease(t)));
    if (type === "P") for (const o of this.actors.values()) if (o.userData.code === u.code) o.userData.march = 1; // 兵列队踏步
    const wheelR = type === "R" ? 0.2 : 0.085;
    let lastDist = 0;
    yield* tween(dur, (t) => {
      const s = type === "N" ? t : ease(t);
      const p = curve.getPointAt(s);
      const tan = curve.getTangentAt(Math.min(0.999, Math.max(0.001, s)));
      actor.rotation.y = shortestYaw(actor.rotation.y, yawTo(tan));
      actor.position.copy(p);
      const body = u.body;
      if (type === "N") {
        // 马：一个跳跃弧线，起跳抬头、落地低头
        actor.position.y = 4 * 1.15 * s * (1 - s);
        body.rotation.x = -0.45 * Math.sin(Math.PI * s) * (s < 0.5 ? 1 : -0.6);
      } else if (type === "R" || type === "C") {
        const d = s * length;
        for (const w of u.parts.wheels) w.rotation.x -= (d - lastDist) / wheelR;
        lastDist = d;
      } else {
        // 迈步：上下起伏、左右摇摆
        const steps = Math.max(2, Math.round(length * (type === "B" ? 2.2 : 3)));
        body.position.y = 0.16 + Math.abs(Math.sin(Math.PI * steps * s)) * (type === "B" ? 0.05 : 0.07);
        body.rotation.z = Math.sin(Math.PI * steps * s) * 0.08;
      }
      this.makeWay(actor);
    });
    u.body.position.y = 0.16;
    u.body.rotation.x = 0;
    u.body.rotation.z = 0;
  }

  // 让路：离移动棋子太近的静止棋子被轻推开，过后弹回，保证不穿模
  makeWay(mover) {
    for (const o of this.actors.values()) {
      const u = o.userData;
      if (u.moving || !u.home) continue;
      const d = new THREE.Vector3(u.home.x - mover.position.x, 0, u.home.z - mover.position.z);
      const dist = d.length();
      const lift = mover.position.y;
      if (dist < CLEAR && lift < 0.95) {
        d.multiplyScalar(1 / (dist || 1));
        const need = CLEAR - dist;
        if (need > u.offset.length()) u.offset.copy(d).multiplyScalar(need);
        o.position.copy(u.home).add(u.offset);
      }
    }
  }

  // 近身吃子：走到目标前方，出招，把对方打飞，再走进格子
  *meleeCapture(actor, target, start, end, type) {
    const dir = end.clone().sub(start).setY(0).normalize();
    const stop = end.clone().addScaledVector(dir, -0.82);
    const approach = start.distanceTo(stop) > 0.15 ? this.route(start, stop, type, actor, [target]) : null;
    if (approach) yield* this.travel(actor, approach, type);
    else {
      const y0 = actor.rotation.y;
      const y1 = shortestYaw(y0, yawTo(dir));
      yield* tween(0.2, (t) => (actor.rotation.y = y0 + (y1 - y0) * ease(t)));
    }
    this.focus = { kind: "attack", actor, target, at: end.clone(), dir };
    yield* this.strike(actor, type, () => this.knock(target, dir, type === "R" ? 6.5 : 5));
    actor.userData.moving = true;
    yield* this.travel(actor, [actor.position.clone(), end], type);
  }

  // 出招：兵刺枪、马踢、车撞、象踏、帅挥剑、士扇
  *strike(actor, type, hit) {
    const u = actor.userData;
    const p = u.parts;
    const body = u.body;
    if (type === "P" || type === "K" || type === "A") {
      const spear = p.spear;
      const z0 = spear.position.z, rx0 = spear.rotation.x;
      yield* tween(0.18, (t) => {
        spear.position.z = z0 - 0.08 * ease(t);
        body.rotation.x = -0.1 * t;
      });
      let fired = false;
      yield* tween(0.12, (t) => {
        spear.position.z = z0 - 0.08 + 0.36 * ease(t);
        if (type !== "P") spear.rotation.x = rx0 + 1.1 * ease(t);
        body.rotation.x = 0.18 * t;
        if (t > 0.6 && !fired) {
          fired = true;
          hit();
        }
      });
      yield* tween(0.25, (t) => {
        spear.position.z = z0 + 0.28 * (1 - ease(t));
        spear.rotation.x = rx0 + (type !== "P" ? 1.1 * (1 - ease(t)) : 0);
        body.rotation.x = 0.18 * (1 - t);
      });
    } else if (type === "N" || type === "B") {
      // 扬起前身，再重重落下
      yield* tween(0.28, (t) => (body.rotation.x = -0.55 * ease(t)));
      let fired = false;
      yield* tween(0.12, (t) => {
        body.rotation.x = -0.55 + 0.75 * ease(t);
        if (t > 0.5 && !fired) {
          fired = true;
          hit();
        }
      });
      yield* tween(0.2, (t) => (body.rotation.x = 0.2 * (1 - t)));
    } else if (type === "R") {
      // 战车加速前冲
      const from = actor.position.clone();
      const dir = new THREE.Vector3(Math.sin(actor.rotation.y), 0, Math.cos(actor.rotation.y));
      let fired = false;
      yield* tween(0.18, (t) => {
        actor.position.copy(from).addScaledVector(dir, 0.35 * t * t);
        for (const w of p.wheels) w.rotation.x -= 0.25;
        if (t > 0.7 && !fired) {
          fired = true;
          hit();
        }
      });
      yield* tween(0.15, (t) => actor.position.copy(from).addScaledVector(dir, 0.35 * (1 - t * 0.5)));
    } else hit();
  }

  // 被打飞：交给刚体模拟，之后收走
  knock(target, dir, power) {
    const at = target.position.clone();
    this.fx.flash(at);
    this.fx.puff(at, 18, 0.8);
    const v = dir.clone().multiplyScalar(power * (0.8 + this.rng() * 0.4)).add(new THREE.Vector3(0, 3.2 + this.rng() * 1.5, 0));
    const side = new THREE.Vector3(-dir.z, 0, dir.x);
    const spin = side.multiplyScalar(-(5 + this.rng() * 5)).add(new THREE.Vector3(0, (this.rng() - 0.5) * 6, 0));
    target.userData.moving = true;
    const body = this.world.add(new Body(target, v, spin));
    const rec = { actor: target, body };
    this.loose.push(rec);
    this.emit({ type: "knock", actor: target });
    this.run(this.cleanup(rec));
  }

  *cleanup(rec) {
    // 等它倒下、静止（最多 3.5 秒）
    let t = 0;
    while (!rec.body.asleep && t < 3.5) t += yield;
    yield* wait(0.45);
    this.world.remove(rec.body);
    const a = rec.actor;
    const color = a.userData.color;
    if (this.rng() < 0.55) {
      // 抬离棋盘，放进己方托盘
      const tray = this.trays[color];
      const slot = traySlot(tray, tray.count++);
      const p0 = a.position.clone();
      const q0 = a.quaternion.clone();
      const q1 = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, a.userData.baseYaw, 0));
      const s0 = a.scale.x;
      const apex = Math.max(p0.y, slot.y) + 2.2;
      yield* tween(1.0, (t) => {
        const e = ease(t);
        a.position.lerpVectors(p0, slot, e);
        a.position.y = (1 - e) * p0.y + e * slot.y + Math.sin(Math.PI * e) * (apex - Math.max(p0.y, slot.y));
        a.quaternion.slerpQuaternions(q0, q1, Math.min(1, e * 1.4));
        a.scale.setScalar(s0 + (0.55 - s0) * e);
      });
      tray.pieces = tray.pieces || [];
      tray.pieces.push(a);
    } else {
      // 化作花瓣消散
      this.fx.petalsFrom(a.position.clone().add(new THREE.Vector3(0, 0.3, 0)), 80);
      const s0 = a.scale.x;
      yield* tween(0.7, (t) => {
        a.scale.setScalar(s0 * (1 - ease(t)));
        a.position.y += 0.004;
      });
      this.scene.remove(a);
    }
    this.loose.splice(this.loose.indexOf(rec), 1);
  }

  // 炮：投石机抛石，真实抛体越过炮架，砸中目标，然后绕过炮架开到目标格
  *cannonCapture(actor, target, start, end, entry) {
    const u = actor.userData;
    const dir = end.clone().sub(start).setY(0).normalize();
    const y0 = actor.rotation.y;
    const y1 = shortestYaw(y0, yawTo(dir));
    yield* tween(0.3, (t) => (actor.rotation.y = y0 + (y1 - y0) * ease(t)));
    const arm = u.parts.arm;
    // 蓄力
    yield* tween(0.35, (t) => (arm.rotation.x = -0.75 - 0.35 * ease(t)));
    // 炮架有多高：取路线上最高的棋子
    let screenTop = 1.0;
    for (const o of this.actors.values()) {
      const rel = o.position.clone().sub(start);
      const along = rel.dot(dir);
      if (along > 0.2 && along < start.distanceTo(end) - 0.2 && Math.abs(rel.x * dir.z - rel.z * dir.x) < 0.5) screenTop = Math.max(screenTop, 1.05);
    }
    let shot = null;
    const stoneMesh = u.parts.stone;
    yield* tween(0.16, (t) => {
      arm.rotation.x = -1.1 + 2.0 * ease(t);
      if (!shot && t > 0.55) {
        const p0 = new THREE.Vector3();
        stoneMesh.getWorldPosition(p0);
        const p1 = end.clone().setY(0.6);
        shot = ballistic(p0, p1, screenTop + 1.0 + start.distanceTo(end) * 0.12);
        shot.p0 = p0;
        stoneMesh.visible = false;
      }
    });
    this.focus = { kind: "fire", actor, target, from: start.clone(), at: end.clone(), dir };
    this.emit({ type: "fire", angle: shot.angle, time: shot.T, entry });
    // 石头按 x = x0 + v t，y = y0 + vy t − g t²/2 飞行
    const stone = new THREE.Mesh(new THREE.SphereGeometry(0.07, 12, 10), new THREE.MeshStandardMaterial({ color: "#7d7a74", roughness: 0.9 }));
    stone.castShadow = true;
    this.scene.add(stone);
    let ft = 0;
    while (ft < shot.T) {
      ft = Math.min(shot.T, ft + (yield));
      stone.position.set(shot.p0.x + shot.v.x * ft, shot.p0.y + shot.v.y * ft - 0.5 * GRAVITY * ft * ft, shot.p0.z + shot.v.z * ft);
      stone.rotation.x += 0.3;
      this.focus.stone = stone.position;
    }
    // 命中
    this.fx.flash(end);
    this.fx.puff(end, 40, 1.4);
    this.knock(target, dir, 5.5);
    // 石头弹开后消失
    const sv = new THREE.Vector3(shot.v.x * 0.25, 2.2, shot.v.z * 0.25);
    this.run(
      (function* () {
        let t = 0;
        while (t < 0.9) {
          const dt = yield;
          t += dt;
          sv.y -= GRAVITY * dt;
          stone.position.addScaledVector(sv, dt);
          if (stone.position.y < 0.07) {
            stone.position.y = 0.07;
            sv.y = -sv.y * 0.35;
            sv.x *= 0.6;
            sv.z *= 0.6;
          }
          stone.scale.setScalar(1 - Math.max(0, t - 0.6) / 0.3);
        }
        stone.parent?.remove(stone);
      })(),
    );
    yield* tween(0.3, (t) => (arm.rotation.x = 0.9 - 1.65 * ease(t)));
    stoneMesh.visible = true;
    yield* wait(0.2);
    // 绕过炮架开过去
    u.moving = true;
    yield* this.travel(actor, this.route(start, end, "C", actor, [target]), "C");
  }
}
