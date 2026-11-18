/**
 * [INPUT]: 依赖 engine 的自检与走法、game/match 的对局入口、ai/rng 的种子、render 的场景与导播、sim 的演出舞台
 * [OUTPUT]: 无导出。页面入口；在 window.__xq 上留一个调试把手
 * [POS]: 总控。回合流程：引擎决定 → AI 选择 → 演出 → 导播。各层只通过走法记录交流。
 *        适配屏幕也在这里：视野随宽高比变、轻点才算落子、窄屏默认收起设置。
 *        界面文案是小朋友版：按钮、菜单、终局弹窗与状态栏都说大白话，终局原因在显示时翻译。
 * [PROTOCOL]: Update this header on change, then check CLAUDE.md
 */
import * as THREE from "three";
import { selfTest, legalMoves, fileOf, rankOf, sq } from "./engine/xiangqi.js";
import { createMatch, decide, commit, startTurn, branch } from "./game/match.js";
import { makeRng, freshSeed } from "./ai/rng.js";
import { createWorld, toWorld } from "./render/world.js";
import { Stage } from "./sim/show.js";
import { Director } from "./render/director.js";

const $ = (id) => document.getElementById(id);
// 终局原因的大白话：引擎里的原因是给测试和棋谱看的，弹窗上说小朋友听得懂的话
const KID_REASON = (r) =>
  r === "将被吃" ? "帥（將）被吃掉啦"
  : /将死/.test(r) ? "对方的帥（將）逃不掉啦"
  : /困毙/.test(r) ? "对方一个能走的棋子都没有啦"
  : /重复/.test(r) ? "双方把一样的棋走了一遍又一遍，算平局"
  : /无吃子/.test(r) ? "好久好久都没吃子，握握手算平局"
  : /上限/.test(r) ? "这盘棋下得太长啦，算平局"
  : r;
// 「爱冒险」滑杆的大白话档位：数值是给行家看的，小朋友只看词
const tempWord = (t) =>
  t < 0.15 ? "特别稳重" : t < 0.35 ? "稳重" : t < 0.6 ? "有点冒险" : t < 0.85 ? "爱冒险" : "特别爱冒险";

// ---- 自检 ---------------------------------------------------------------------------
const test = selfTest();
if (test.ok) console.info(`[象棋自检] 通过：初始局面红方合法走法 ${test.count} 个（应为 ${test.expected}）`);
else {
  console.error(`[象棋自检] 失败：初始局面红方合法走法 ${test.count} 个，应为 ${test.expected}`);
  $("selftest").className = "badge fail";
  $("selftest").title = "规则引擎自检失败";
  $("selftest").textContent = `自检失败 ${test.count}/${test.expected}`;
}

// ---- 场景 ---------------------------------------------------------------------------
const canvas = $("scene");
const { renderer, scene, camera, trays, pickPlane } = createWorld(canvas);
const stage = new Stage(scene, camera, trays, makeRng("init"));
const director = new Director(camera, canvas);
director.obstacles = () => [...stage.actors.values()];
canvas.addEventListener("contextmenu", (e) => e.preventDefault());

// 竖屏时把垂直视野撑大，让水平视野不小于 6:5 画面时的宽度；否则手机上只剩一条窄缝，全是特写
const FOV = { base: 38, aspect: 1.2, max: 78 };
function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  const half = Math.tan(THREE.MathUtils.degToRad(FOV.base / 2));
  camera.fov = camera.aspect >= FOV.aspect ? FOV.base : Math.min(FOV.max, THREE.MathUtils.radToDeg(2 * Math.atan((half * FOV.aspect) / camera.aspect)));
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
  $("end").classList.add("hidden");
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
// 终局弹窗：点空白处或「回看棋盘」都能收起，留在终局局面慢慢看
$("btn-again").onclick = () => newGame(freshSeed());
$("btn-review").onclick = () => $("end").classList.add("hidden");
$("end").onclick = (e) => {
  if (e.target.id === "end") $("end").classList.add("hidden");
};

// 界面显示某组设置（重放时跟随原局）
function showSettings(st) {
  settings.temperature = st.temperature;
  settings.depth = st.depth;
  $("temp").value = String(st.temperature);
  $("temp-out").textContent = tempWord(st.temperature);
  $("depth").value = String(st.depth);
}
// 重放途中用户自己改了东西：从这里起按新的来
function userChanged() {
  if (match?.replay) {
    branch(match);
    status("已偏离重放，从这一步起按现在的玩法继续");
  }
}
$("btn-pause").onclick = () => setPaused(!paused);
function setFolded(folded) {
  $("controls").classList.toggle("folded", folded);
  $("btn-fold").textContent = folded ? "设置" : "收起来";
}
$("btn-fold").onclick = () => setFolded(!$("controls").classList.contains("folded"));
// 设置面板默认收起，把画面让给棋盘。窄屏上棋谱做成抽屉，和设置面板不同时展开
setFolded(true);
$("btn-record").onclick = () => {
  if ($("record").classList.toggle("open")) setFolded(true);
};
$("btn-fold").addEventListener("click", () => $("record").classList.remove("open"));
function setPaused(p) {
  paused = p;
  $("btn-pause").textContent = paused ? "继续" : "暂停";
  $("btn-pause").setAttribute("aria-pressed", String(paused));
  status(paused ? "暂停啦，点「继续」或按空格键接着下" : "");
}
$("speed").oninput = (e) => {
  speed = Number(e.target.value);
  $("speed-out").textContent = `${speed.toFixed(1)}×`;
};
$("temp").oninput = (e) => {
  settings.temperature = Number(e.target.value);
  $("temp-out").textContent = tempWord(settings.temperature);
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
// 轻点才算落子：按下和抬起几乎在同一处。拖动是在转镜头（触屏上尤其如此），不能误选棋子
let press = null;
canvas.addEventListener("pointerdown", (e) => {
  press = e.button === 0 ? { x: e.clientX, y: e.clientY, at: performance.now() } : null;
});
canvas.addEventListener("pointerup", (e) => {
  const tap = press && Math.hypot(e.clientX - press.x, e.clientY - press.y) < 10 && performance.now() - press.at < 600;
  press = null;
  if (!tap || phase !== "human" || paused) return;
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
    status("重放：这一步是当时你下的");
    ready = { choice: scripted, at: performance.now() + 700 / speed };
    phase = "ready";
    return;
  }
  if (replaying && !match.replay) status("重放完啦，接着往下下");
  // 重放进行中：原局由电脑下的步照样交给电脑，保证逐步一致
  if (control[side] === "human" && !match.replay) {
    phase = "human";
    status("轮到你走啦：先点自己的棋子，再点它要去的地方");
    return;
  }
  phase = "think";
  thinker = decide(match);
  thinkStart = performance.now();
  status(`${side === "r" ? "红" : "黑"}方在想怎么走…`);
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
  say(rec.comment, rec.replayed ? "重放你当时的走法" : rec.kind === "book" ? "书本上的经典开局" : rec.kind === "blunder" ? "太爱冒险，走错啦" : rec.kind === "soft" ? "爱冒险让它走了一步不太好的棋" : "");
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
  const title = r.winner ? (r.winner === "r" ? "红方赢啦" : "黑方赢啦") : "平局啦";
  $("banner-title").textContent = title;
  $("banner-sub").textContent = `${KID_REASON(r.reason)} · 走了 ${match.log.length} 步 · 种子 ${seed}`;
  $("end").classList.remove("hidden");
  say(`${title}：${KID_REASON(r.reason)}`, "下完啦，所有棋子都亮开给大家看");
  status($("auto-next").checked ? "马上开始新的一局" : "这盘棋下完啦");
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
  get drawn() { return { calls: renderer.info.render.calls, triangles: renderer.info.render.triangles, fov: Math.round(camera.fov) }; },
  fps() {
    return new Promise((res) => {
      let n = 0;
      const t0 = performance.now();
      const f = () => (performance.now() - t0 < 2000 ? (n++, requestAnimationFrame(f)) : res(Math.round(n / 2)));
      requestAnimationFrame(f);
    });
  },
};
