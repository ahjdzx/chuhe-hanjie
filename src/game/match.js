// 一盘对局：把规则引擎和 AI 串起来。仍然是纯逻辑，可在 Node 里无界面地跑完整盘。
import { RED, BLACK, createGame, play, outcome, legalMoves, notate } from "../engine/xiangqi.js";
import { makeRng } from "../ai/rng.js";
import { createArmy, think, winRate } from "../ai/brain.js";
import { commentFor, endComment } from "../ai/commentary.js";

// script：上一盘的「对局脚本」（初始设置 + 按步记录的设置改动和人类走子）。传入它就能精确重放。
export function createMatch(seed, settings = {}, script = null) {
  const root = makeRng(seed);
  const initial = { temperature: 0.35, depth: 3, ...(script ? script.settings : settings) };
  return {
    seed,
    settings: { ...initial },
    state: createGame(),
    armies: { r: createArmy(root.fork("army-r"), RED), b: createArmy(root.fork("army-b"), BLACK) },
    rng: root.fork("choice"),
    log: [],
    result: { over: false },
    winRate: 0.5,
    script: { seed, settings: { ...initial }, events: [] },
    replay: script ? script.events.slice() : null,
  };
}

const sameSettings = (a, b) => a.temperature === b.temperature && a.depth === b.depth;

// 回合开始：重放时按脚本设定；否则采用界面上的当前设置，有变化就记进脚本
export function startTurn(match, live) {
  const ply = match.log.length;
  if (match.replay) {
    const ev = match.replay.find((e) => e.ply === ply && e.type === "settings");
    if (ev) {
      match.settings = { temperature: ev.temperature, depth: ev.depth };
      match.script.events.push({ ...ev });
    }
    const human = match.replay.find((e) => e.ply === ply && e.type === "human");
    if (!match.replay.some((e) => e.ply > ply || (e.ply === ply && e.type === "human"))) match.replay = null; // 脚本走完
    if (human) {
      const move = legalMoves(match.state.board, match.state.side).find((m) => m.from === human.from && m.to === human.to);
      if (move) return { scripted: { move, kind: "human", replayed: true } };
    }
    return { scripted: null };
  }
  if (live && !sameSettings(live, match.settings)) {
    match.settings = { temperature: live.temperature, depth: live.depth };
    match.script.events.push({ ply, type: "settings", ...match.settings });
  }
  return { scripted: null };
}

// 重放途中用户改了东西：从这里起不再跟随脚本
export function branch(match) {
  match.replay = null;
}

// 生成器：AI 思考（可分片推进），返回选择
export function* decide(match) {
  const army = match.armies[match.state.side];
  return yield* think(match.state, army, match.rng, match.settings);
}

// 落子：唯一会改变对局状态的入口，并且只接受合法走法
export function commit(match, choice) {
  const { state } = match;
  const legal = legalMoves(state.board, state.side);
  const m = legal.find((l) => l.from === choice.move.from && l.to === choice.move.to);
  if (!m) throw new Error("非法走法被拒绝：" + JSON.stringify(choice.move));
  const entry = play(state, m);
  const comment = commentFor(state.board, entry, choice);
  match.result = outcome(state);
  match.winRate = match.result.over ? (match.result.winner === RED ? 1 : match.result.winner === BLACK ? 0 : 0.5) : winRate(state.board, state.side);
  if (choice.kind === "human") match.script.events.push({ ply: match.log.length, type: "human", from: m.from, to: m.to });
  const record = { ...entry, comment, kind: choice.kind, replayed: !!choice.replayed, end: match.result.over ? endComment(match.result) : "" };
  match.log.push(record);
  return record;
}

export function runSync(seed, settings, maxPlies = 400) {
  const match = createMatch(seed, settings);
  while (!match.result.over && match.log.length < maxPlies) {
    const it = decide(match);
    let r = it.next();
    while (!r.done) r = it.next();
    commit(match, r.value);
  }
  return match;
}

export { legalMoves, notate };
