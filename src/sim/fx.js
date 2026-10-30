// 特效：扬尘、花瓣、撞击闪光、飞行中的石头。纯表现，不影响任何状态。
import * as THREE from "three";
import { groundAt } from "../render/world.js";

function softDot() {
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const g = c.getContext("2d");
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, "rgba(255,255,255,1)");
  grad.addColorStop(0.5, "rgba(255,255,255,0.45)");
  grad.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export class Effects {
  constructor(scene, camera) {
    this.scene = scene;
    this.camera = camera;
    this.dot = softDot();
    this.parts = [];
    // 扬尘：实例化的公告板小方片
    this.dustMax = 400;
    this.dust = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: this.dot, transparent: true, depthWrite: false, color: "#d9c3a0", opacity: 0.55 }), this.dustMax);
    this.dust.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.dust.count = 0;
    this.dust.frustumCulled = false;
    scene.add(this.dust);
    // 花瓣：实例化的双面小片
    this.petalMax = 500;
    const petalGeo = new THREE.CircleGeometry(0.07, 6);
    petalGeo.scale(1, 0.6, 1);
    this.petals = new THREE.InstancedMesh(petalGeo, new THREE.MeshStandardMaterial({ color: "#f3a6b8", side: THREE.DoubleSide, roughness: 0.6, transparent: true, opacity: 0.95 }), this.petalMax);
    this.petals.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.petals.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(this.petalMax * 3), 3);
    this.petals.count = 0;
    this.petals.frustumCulled = false;
    this.petals.castShadow = true;
    scene.add(this.petals);
    // 撞击闪光：点光源 + 发光片
    this.flashLight = new THREE.PointLight("#ffd28a", 0, 6, 1.6);
    scene.add(this.flashLight);
    this.glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.dot, color: "#ffe2a8", transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0 }));
    this.glow.scale.setScalar(2.2);
    scene.add(this.glow);
    this.flashAge = 99;
    this.m = new THREE.Matrix4();
    this.q = new THREE.Quaternion();
    this.s = new THREE.Vector3();
    this.c = new THREE.Color();
  }

  puff(at, count = 26, power = 1) {
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = (0.6 + Math.random() * 1.4) * power;
      this.parts.push({ kind: "dust", p: at.clone().add(new THREE.Vector3(0, 0.05, 0)), v: new THREE.Vector3(Math.cos(a) * sp, 0.4 + Math.random() * 0.9 * power, Math.sin(a) * sp), age: 0, life: 0.9 + Math.random() * 0.7, size: 0.25 + Math.random() * 0.35 });
    }
  }

  petalsFrom(at, count = 70, wind = new THREE.Vector3(0.6, 0, -0.2)) {
    for (let i = 0; i < count; i++) {
      const p = at.clone().add(new THREE.Vector3((Math.random() - 0.5) * 0.6, Math.random() * 0.8, (Math.random() - 0.5) * 0.6));
      const pink = Math.random();
      this.parts.push({
        kind: "petal",
        p,
        v: new THREE.Vector3((Math.random() - 0.5) * 1.2, 0.8 + Math.random() * 1.6, (Math.random() - 0.5) * 1.2),
        rot: new THREE.Euler(Math.random() * 6, Math.random() * 6, Math.random() * 6),
        spin: new THREE.Vector3(Math.random() * 6 - 3, Math.random() * 6 - 3, Math.random() * 6 - 3),
        wind,
        age: 0,
        life: 2.2 + Math.random() * 1.6,
        color: new THREE.Color().setHSL(0.95 + pink * 0.04, 0.7, 0.75 + pink * 0.1),
      });
    }
  }

  flash(at) {
    this.flashLight.position.copy(at).add(new THREE.Vector3(0, 0.6, 0));
    this.glow.position.copy(at).add(new THREE.Vector3(0, 0.5, 0));
    this.flashAge = 0;
  }

  update(dt) {
    // 闪光：快速起，指数衰减，不会突然消失
    this.flashAge += dt;
    const env = this.flashAge < 0.05 ? this.flashAge / 0.05 : Math.exp(-(this.flashAge - 0.05) / 0.12);
    this.flashLight.intensity = 30 * env;
    this.glow.material.opacity = 0.9 * env;
    this.glow.scale.setScalar(1.6 + (1 - env) * 1.4);

    let nd = 0, np = 0;
    const camQ = this.camera.quaternion;
    this.parts = this.parts.filter((pt) => (pt.age += dt) < pt.life);
    for (const pt of this.parts) {
      const t = pt.age / pt.life;
      if (pt.kind === "dust") {
        pt.v.multiplyScalar(1 - 2.2 * dt);
        pt.v.y -= 0.6 * dt;
        pt.p.addScaledVector(pt.v, dt);
        const g = groundAt(pt.p.x, pt.p.z) + 0.05;
        if (pt.p.y < g) pt.p.y = g;
        if (nd < this.dustMax) {
          const size = pt.size * (1 + t * 2.2);
          this.s.setScalar(size * (1 - t * 0.3));
          this.m.compose(pt.p, camQ, this.s);
          this.dust.setMatrixAt(nd++, this.m);
        }
      } else {
        // 花瓣：重力 + 空气阻力 + 风，翻转着飘落
        pt.v.y -= 2.2 * dt;
        pt.v.lerp(pt.wind, 1 - Math.exp(-dt * 1.2));
        pt.v.y = Math.max(pt.v.y, -0.7);
        pt.p.addScaledVector(pt.v, dt);
        const g = groundAt(pt.p.x, pt.p.z) + 0.01;
        if (pt.p.y < g) {
          pt.p.y = g;
          pt.v.multiplyScalar(0.5);
        }
        pt.rot.x += pt.spin.x * dt;
        pt.rot.y += pt.spin.y * dt;
        pt.rot.z += pt.spin.z * dt;
        if (np < this.petalMax) {
          this.q.setFromEuler(pt.rot);
          this.s.setScalar(t > 0.8 ? (1 - t) / 0.2 : 1);
          this.m.compose(pt.p, this.q, this.s);
          this.petals.setMatrixAt(np, this.m);
          this.petals.setColorAt(np++, pt.color);
        }
      }
    }
    this.dust.count = nd;
    this.petals.count = np;
    this.dust.instanceMatrix.needsUpdate = true;
    this.petals.instanceMatrix.needsUpdate = true;
    if (this.petals.instanceColor) this.petals.instanceColor.needsUpdate = true;
  }

  clear() {
    this.parts = [];
    this.flashAge = 99;
  }
}
