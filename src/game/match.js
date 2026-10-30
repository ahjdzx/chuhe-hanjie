// 一盘对局：把规则引擎和 AI 串起来。仍然是纯逻辑，可在 Node 里无界面地跑完整盘。
import { RED, BLACK, createGame, play, outcome, legalMoves, notate } from "../engine/xiangqi.js";
import { makeRng } from "../ai/rng.js";
import { createArmy, think, winRate } from "../ai/brain.js";
import { commentFor, endComment } from "../ai/commentary.js";

export function createMatch(seed, settings = {}) {
  const root = makeRng(seed);
  return {
    seed,
    settings: { temperature: 0.35, depth: 3, ...settings },
    state: createGame(),
    armies: { r: createArmy(root.fork("army-r"), RED), b: createArmy(root.fork("army-b"), BLACK) },
    rng: root.fork("choice"),
    log: [],
    result: { over: false },
    winRate: 0.5,
  };
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
  match.winRate = match.result.over ? (match.result.winner === RED ? 1 : match.result.winner === BLACK ? 0 : 0.5) : winRate(state.board);
  const record = { ...entry, comment, kind: choice.kind, end: match.result.over ? endComment(match.result) : "" };
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
