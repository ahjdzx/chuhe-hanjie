// 自动导播：根据演出层的焦点选镜头，用临界阻尼弹簧平滑推拉；也支持自由视角和俯视。
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

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

  // 每帧：从焦点算出想要的机位
  update(dt, focus, playing) {
    if (this.mode === "free") {
      this.controls.update();
      this.eye.snap(this.camera.position);
      this.look.snap(this.controls.target);
      return;
    }
    let eye, look, time = 1.1;
    if (this.mode === "top") {
      eye = new THREE.Vector3(0, 19, 2.2);
      look = new THREE.Vector3(0, 0, 0.2);
      time = 0.6;
    } else {
      this.shotAge += dt;
      this.orbit += dt * (playing ? 0.05 : 0.12);
      const wide = () => {
        const r = 13.5;
        return [new THREE.Vector3(Math.sin(this.orbit) * r * 0.55, 11.5, Math.cos(this.orbit) * r), new THREE.Vector3(0, 0, 0)];
      };
      const f = focus || { kind: "idle" };
      if (f.kind === "move" && f.actor) {
        // 跟拍：在移动方向的斜后方，拉开到能看到周围的局面
        const p = f.actor.position;
        const dir = f.to.clone().sub(f.from).setY(0);
        if (dir.lengthSq() < 1e-4) dir.set(0, 0, -1);
        dir.normalize();
        const side = new THREE.Vector3(-dir.z, 0, dir.x);
        const span = f.from.distanceTo(f.to);
        const mid = f.from.clone().lerp(f.to, 0.5);
        const focus = mid.lerp(p, 0.5);
        eye = focus.clone().addScaledVector(dir, -5.2 - span * 0.35).addScaledVector(side, 3.4).add(new THREE.Vector3(0, 6 + span * 0.3, 0));
        look = focus.clone().addScaledVector(dir, 0.8);
        time = 0.6;
      } else if ((f.kind === "attack" || f.kind === "fire") && f.at) {
        // 动作镜头：低机位，从攻击方向的侧面看
        const side = new THREE.Vector3(-f.dir.z, 0, f.dir.x);
        const mid = f.kind === "fire" ? f.from.clone().lerp(f.at, 0.5) : f.at.clone();
        // 选离当前机位更近、又更靠桌子中间的一侧，避免甩镜头和拍到桌外
        const score = (sgn) => this.eye.x.distanceTo(mid.clone().addScaledVector(side, sgn * 5)) + mid.clone().addScaledVector(side, sgn * 5).setY(0).length() * 0.6;
        if (score(-1) < score(1)) side.negate();
        const dist = f.kind === "fire" ? Math.max(6, f.from.distanceTo(f.at) * 0.95 + 3) : 4.6;
        eye = mid.clone().addScaledVector(side, dist).add(new THREE.Vector3(0, f.kind === "fire" ? 4 : 2.2, 0)).addScaledVector(f.dir, -1);
        look = (f.stone && f.kind === "fire" ? mid.clone().lerp(f.stone, 0.35) : mid.clone()).add(new THREE.Vector3(0, 0.5, 0));
        time = 0.4;
      } else if (f.kind === "check" && f.at) {
        // 将军：从对方将帅一侧推近
        const p = f.at;
        eye = new THREE.Vector3(p.x * 0.6 + 3.2, 5.2, p.z + Math.sign(p.z || 1) * 5.5);
        look = new THREE.Vector3(p.x * 0.5, 0.3, p.z * 0.6);
        time = 0.9;
      } else if (f.kind === "over" && f.at) {
        const r = 5;
        eye = new THREE.Vector3(f.at.x + Math.sin(this.orbit * 3) * r, 3.4, f.at.z + Math.cos(this.orbit * 3) * r);
        look = f.at.clone().add(new THREE.Vector3(0, 0.5, 0));
        time = 1.2;
      } else {
        [eye, look] = wide();
        time = f.kind === "settle" ? 1.6 : 1.3;
      }
    }
    // 机位始终留在桌面上空、不低于一定高度
    if (this.mode === "auto") {
      eye.x = Math.max(-10, Math.min(10, eye.x));
      eye.z = Math.max(-11.5, Math.min(11.5, eye.z));
      eye.y = Math.max(3, eye.y);
    }
    this.camera.position.copy(this.eye.step(eye, dt, time));
    this.camera.lookAt(this.look.step(look, dt, time * 0.8));
  }
}
