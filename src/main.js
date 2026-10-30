// 总控：规则引擎决定，AI 选择，演出层表演，导播拍摄。各层只通过走法记录交流。
import * as THREE from "three";
import { selfTest, legalMoves, fileOf, rankOf, sq } from "./engine/xiangqi.js";
import { createMatch, decide, commit, startTurn, branch } from "./game/match.js";
import { makeRng, freshSeed } from "./ai/rng.js";
import { createWorld, toWorld } from "./render/world.js";
import { Stage } from "./sim/show.js";
import { Director } from "./render/director.js";

const $ = (id) => document.getElementById(id);

// ---- 自检 ---------------------------------------------------------------------------
const test = selfTest();
if (test.ok) console.info(`[象棋自检] 通过：初始局面红方合法走法 ${test.count} 个（应为 ${test.expected}）`);
else {
  console.error(`[象棋自检] 失败：初始局面红方合法走法 ${test.count} 个，应为 ${test.expected}`);
  $("selftest").className = "badge fail";
  $("selftest").textContent = `自检失败 ${test.count}/${test.expected}`;
}

// ---- 场景 ---------------------------------------------------------------------------
const canvas = $("scene");
const { renderer, scene, camera, trays, pickPlane } = createWorld(canvas);
const stage = new Stage(scene, camera, trays, makeRng("init"));
const director = new Director(camera, canvas);
director.obstacles = () => [...stage.actors.values()];
canvas.addEventListener("contextmenu", (e) => e.preventDefault());

function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
window.addEventListener("resize", resize);
resize();

// ---- 状态 ---------------------------------------------------------------------------
const settings = { temperature: 0.35, depth: 3 };
const control = { r: "ai", b: "ai" };
let match = null;
let seed = freshSeed();
let paused = false;
let speed = 1;
let phase = "gap"; // gap | think | human | show | over
let gap = 1.2;
let thinker = null;
let thinkStart = 0;
let overTimer = 0;
let ready = null;
const camDir = new THREE.Vector3();
let windYaw = 0;

function newGame(s, script = null) {
  seed = s;
  match = createMatch(seed, { ...settings }, script);
  if (script) showSettings(match.settings);
  stage.reset(match.state.board, makeRng(seed).fork("show"));
  $("seed").textContent = seed;
  $("moves").innerHTML = "";
  $("army-r").textContent = `${match.armies.r.persona.name} · 偏好${match.armies.r.book}`;
  $("army-b").textContent = `${match.armies.b.persona.name} · 偏好${match.armies.b.book}`;
  setWin(0.5);
  say(script ? `重放种子 ${seed}` : `新的一局，种子 ${seed}`, script && script.events.length ? `按原局的 ${script.events.length} 处设置改动和你的走法精确重放` : `红方 ${match.armies.r.persona.name}，黑方 ${match.armies.b.persona.name}`);
  $("banner").classList.add("hidden");
  thinker = null;
  ready = null;
  clearMarks();
  phase = "gap";
  gap = 1.4;
}

// ---- 界面 ---------------------------------------------------------------------------
function setWin(p) {
  $("win-fill").style.transform = `scaleX(${p.toFixed(3)})`;
  $("win-red").textContent = `红 ${Math.round(p * 100)}%`;
  $("win-black").textContent = `黑 ${Math.round((1 - p) * 100)}%`;
}
function say(text, sub = "") {
  $("comment-text").textContent = text;
  $("comment-sub").textContent = sub;
  const el = $("comment");
  el.classList.remove("pop");
  void el.offsetWidth;
  el.classList.add("pop");
  setTimeout(() => el.classList.remove("pop"), 300);
}
function status(text) {
  $("status").textContent = text;
}
function addMove(rec) {
  const list = $("moves");
  const ply = match.log.length;
  const n = Math.ceil(ply / 2);
  let li = list.querySelector(`li[data-n="${n}"]`);
  if (!li) {
    li = document.createElement("li");
    li.dataset.n = n;
    li.innerHTML = `<span class="n">${n}.</span><span class="r"></span><span class="b"></span>`;
    list.appendChild(li);
  }
  const cell = li.querySelector(rec.side === "r" ? ".r" : ".b");
  cell.textContent = rec.notation + (rec.check ? "+" : "");
  if (rec.captured) cell.classList.add("cap");
  list.querySelectorAll("li.latest").forEach((x) => x.classList.remove("latest"));
  li.classList.add("latest");
  list.scrollTop = list.scrollHeight;
}

$("btn-new").onclick = () => newGame(freshSeed());
$("btn-replay").onclick = () => newGame(seed, match.script);

// 界面显示某组设置（重放时跟随原局）
function showSettings(st) {
  settings.temperature = st.temperature;
  settings.depth = st.depth;
  $("temp").value = String(st.temperature);
  $("temp-out").textContent = st.temperature.toFixed(2);
  $("depth").value = String(st.depth);
}
// 重放途中用户自己改了东西：从这里起按新的来
function userChanged() {
  if (match?.replay) {
    branch(match);
    status("已偏离重放，从这里起按你的设置继续");
  }
}
$("btn-pause").onclick = () => setPaused(!paused);
$("btn-fold").onclick = () => {
  const panel = $("controls");
  panel.classList.toggle("folded");
  $("btn-fold").textContent = panel.classList.contains("folded") ? "设置" : "收起";
};
function setPaused(p) {
  paused = p;
  $("btn-pause").textContent = paused ? "继续" : "暂停";
  status(paused ? "已暂停" : "");
}
$("speed").oninput = (e) => {
  speed = Number(e.target.value);
  $("speed-out").textContent = `${speed.toFixed(1)}×`;
};
$("temp").oninput = (e) => {
  settings.temperature = Number(e.target.value);
  $("temp-out").textContent = settings.temperature.toFixed(2);
  userChanged(); // 新设置从下一回合开始生效，并记进对局脚本
};
$("depth").onchange = (e) => {
  settings.depth = Number(e.target.value);
  userChanged();
};
$("camera").onchange = (e) => director.setMode(e.target.value);
director.onUserTakeover = (mode) => ($("camera").value = mode);
for (const c of ["r", "b"]) {
  $("ctl-" + c).onchange = (e) => {
    control[c] = e.target.value;
    userChanged();
    // 接管：如果这一方正在思考或等待，重新开始这一回合
    if (match && match.state.side === c && (phase === "think" || phase === "ready" || phase === "human")) {
      thinker = null;
      ready = null;
      clearMarks();
      phase = "gap";
      gap = 0.2;
    }
  };
}
window.addEventListener("keydown", (e) => {
  if (e.key === " " && e.target.tagName !== "INPUT" && e.target.tagName !== "SELECT") {
    e.preventDefault();
    setPaused(!paused);
  }
});
stage.on((ev) => {
  if (ev.type === "fire") $("comment-sub").textContent = `投石：发射角 ${ev.angle.toFixed(0)}°，飞行 ${ev.time.toFixed(2)} 秒，越过炮架`;
});

// ---- 人类走子 ------------------------------------------------------------------------
const marks = new THREE.Group();
scene.add(marks);
let selected = -1;
function clearMarks() {
  marks.clear();
  selected = -1;
}
function markAt(s, color, r = 0.48) {
  const m = new THREE.Mesh(new THREE.RingGeometry(r - 0.07, r, 40), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9, depthWrite: false }));
  m.rotation.x = -Math.PI / 2;
  m.position.copy(toWorld(fileOf(s), rankOf(s))).setY(0.02);
  marks.add(m);
}
const ray = new THREE.Raycaster();
canvas.addEventListener("pointerdown", (e) => {
  if (e.button !== 0 || phase !== "human" || paused) return;
  const ndc = new THREE.Vector2((e.clientX / window.innerWidth) * 2 - 1, -(e.clientY / window.innerHeight) * 2 + 1);
  ray.setFromCamera(ndc, camera);
  const hit = ray.intersectObject(pickPlane)[0];
  if (!hit) return;
  const x = Math.round(hit.point.x + 4), y = Math.round(4.5 - hit.point.z);
  if (x < 0 || x > 8 || y < 0 || y > 9) return;
  const s = sq(x, y);
  const side = match.state.side;
  const legal = legalMoves(match.state.board, side);
  const p = match.state.board[s];
  if (p && p[0] === side) {
    clearMarks();
    selected = s;
    markAt(s, "#e9c46a", 0.52);
    for (const m of legal) if (m.from === s) markAt(m.to, m.captured ? "#ff6b5a" : "#7dd87d", 0.3);
    return;
  }
  if (selected >= 0) {
    const m = legal.find((mm) => mm.from === selected && mm.to === s);
    if (m) {
      clearMarks();
      play({ move: m, kind: "human" });
    }
  }
});

// ---- 回合流程 -----------------------------------------------------------------------
function beginTurn() {
  if (match.result.over) return finish();
  const side = match.state.side;
  const replaying = !!match.replay;
  const { scripted } = startTurn(match, { ...settings });
  if (replaying) showSettings(match.settings);
  if (scripted) {
    // 重放原局里人类下的那一步
    status("重放：当时你下的这一步");
    ready = { choice: scripted, at: performance.now() + 700 / speed };
    phase = "ready";
    return;
  }
  if (replaying && !match.replay) status("重放结束，接着按当前设置下");
  // 重放进行中：原局由电脑下的步照样交给电脑，保证逐步一致
  if (control[side] === "human" && !match.replay) {
    phase = "human";
    status(`轮到你走${side === "r" ? "红" : "黑"}方：点己方棋子，再点目标点`);
    return;
  }
  phase = "think";
  thinker = decide(match);
  thinkStart = performance.now();
  status(`${side === "r" ? "红" : "黑"}方思考中…`);
}

function stepThinker(budget) {
  const t0 = performance.now();
  while (performance.now() - t0 < budget) {
    const r = thinker.next();
    if (r.done) {
      thinker = null;
      return r.value;
    }
  }
  return undefined;
}

function play(choice) {
  const rec = commit(match, choice);
  addMove(rec);
  say(rec.comment, rec.replayed ? "重放你当时的走法" : rec.kind === "book" ? "开局库" : rec.kind === "blunder" ? "高温下的随机失误" : rec.kind === "soft" ? "温度让它选了次优的一步" : "");
  setWin(match.winRate);
  status("");
  phase = "show";
  stage.perform(rec).then(() => {
    if (match.result.over) finish();
    else {
      phase = "gap";
      gap = 0.55;
    }
  });
}

function finish() {
  phase = "over";
  const r = match.result;
  const title = r.winner ? (r.winner === "r" ? "红方胜" : "黑方胜") : "和棋";
  $("banner-title").textContent = title;
  $("banner-sub").textContent = `${r.reason} · 共 ${match.log.length} 步 · 种子 ${seed}`;
  $("banner").classList.remove("hidden");
  say(`${title}：${r.reason}`);
  status($("auto-next").checked ? "稍后自动开始新的一局" : "对局结束");
  const k = r.winner ? match.state.board.findIndex((p) => p === r.winner + "K") : sq(4, 4);
  stage.focus = { kind: "over", at: toWorld(fileOf(Math.max(0, k)), rankOf(Math.max(0, k))) };
  overTimer = 9;
}

// ---- 主循环 -------------------------------------------------------------------------
let last = performance.now();
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  const sdt = paused ? 0 : dt * speed;
  if (!paused && match) {
    if (phase === "gap") {
      gap -= sdt;
      if (gap <= 0) beginTurn();
    } else if (phase === "think" && thinker) {
      const choice = stepThinker(8);
      if (choice !== undefined) {
        if (!choice) finish();
        else {
          // 至少「想」一小会儿，看起来更像在下棋
          ready = { choice, at: thinkStart + 450 / speed };
          phase = "ready";
        }
      }
    } else if (phase === "ready" && ready && now >= ready.at) {
      const c = ready.choice;
      ready = null;
      play(c);
    } else if (phase === "over" && $("auto-next").checked) {
      overTimer -= sdt;
      if (overTimer <= 0) newGame(freshSeed());
    }
  }
  // 风向：垂直于镜头的水平视线，选和上一帧接近的那一侧，缓慢变化
  camera.getWorldDirection(camDir);
  const wa = Math.atan2(camDir.x, camDir.z); // 旗面 +X 轴转到这个朝向时与视线垂直，旗面正对镜头
  const wb = wa + Math.PI;
  const near = (a) => Math.abs(Math.atan2(Math.sin(a - windYaw), Math.cos(a - windYaw)));
  windYaw = near(wa) <= near(wb) ? wa : wb;
  stage.windYaw = windYaw;
  stage.update(sdt);
  director.update(dt, stage.focus, !paused);
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}

newGame(seed);
requestAnimationFrame(frame);

// 调试入口（不影响对局）
window.__xq = {
  get match() { return match; },
  get phase() { return phase; },
  newGame,
  setPaused,
  stage,
  director,
  // 棋盘点在画面上的位置（0..1），给自动化测试点击用
  screenOf(x, y) {
    const v = toWorld(x, y).project(camera);
    return [(v.x + 1) / 2, (1 - v.y) / 2];
  },
  fps() {
    return new Promise((res) => {
      let n = 0;
      const t0 = performance.now();
      const f = () => (performance.now() - t0 < 2000 ? (n++, requestAnimationFrame(f)) : res(Math.round(n / 2)));
      requestAnimationFrame(f);
    });
  },
};
