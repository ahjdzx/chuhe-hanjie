// 棋力对比：新引擎 vs 改进前的引擎（test/baseline），同样深度，每个种子换边各下一盘。
// 用法：node test/strength.mjs [局数对=6] [深度=3] [新引擎深度=同上]
import { createGame, play, outcome, legalMoves, RED } from "../src/engine/xiangqi.js";
import { makeRng } from "../src/ai/rng.js";
import * as NEW from "../src/ai/brain.js";
import * as OLD from "./baseline/brain.js";

const pairs = Number(process.argv[2] || 6);
const depth = Number(process.argv[3] || 3);
const newDepth = Number(process.argv[4] || depth);

function game(seed, newIsRed) {
  const root = makeRng(seed);
  const state = createGame();
  const eng = { r: newIsRed ? NEW : OLD, b: newIsRed ? OLD : NEW };
  const armies = { r: eng.r.createArmy(root.fork("army-r"), "r"), b: eng.b.createArmy(root.fork("army-b"), "b") };
  const rng = root.fork("choice");
  let ms = { new: 0, old: 0, nNew: 0, nOld: 0 };
  let res = { over: false };
  while (!res.over) {
    const side = state.side;
    const isNew = eng[side] === NEW;
    const t = Date.now();
    const it = eng[side].think(state, armies[side], rng, { temperature: 0, depth: isNew ? newDepth : depth });
    let r = it.next();
    while (!r.done) r = it.next();
    const dt = Date.now() - t;
    if (isNew) (ms.new += dt), ms.nNew++;
    else (ms.old += dt), ms.nOld++;
    const m = legalMoves(state.board, side).find((l) => l.from === r.value.move.from && l.to === r.value.move.to);
    play(state, m);
    res = outcome(state);
  }
  const newColor = newIsRed ? "r" : "b";
  const score = res.winner === null ? 0.5 : res.winner === newColor ? 1 : 0;
  return { score, res, plies: state.ply, ms };
}

let total = 0, games = 0, wins = 0, draws = 0, losses = 0;
let tNew = 0, nNew = 0, tOld = 0, nOld = 0;
for (let i = 0; i < pairs; i++) {
  const seed = "BENCH" + i;
  for (const newIsRed of [true, false]) {
    const g = game(seed, newIsRed);
    total += g.score;
    games++;
    if (g.score === 1) wins++;
    else if (g.score === 0) losses++;
    else draws++;
    tNew += g.ms.new;
    nNew += g.ms.nNew;
    tOld += g.ms.old;
    nOld += g.ms.nOld;
    console.log(`${seed} 新引擎执${newIsRed ? "红" : "黑"}：${g.score === 1 ? "胜" : g.score === 0 ? "负" : "和"}（${g.res.reason}，${g.plies} 步）`);
  }
}
console.log(`\n新引擎（深度 ${newDepth}）对旧引擎（深度 ${depth}）：${wins} 胜 ${draws} 和 ${losses} 负，得分率 ${((total / games) * 100).toFixed(0)}%`);
console.log(`平均每步耗时：新 ${Math.round(tNew / nNew)} ms，旧 ${Math.round(tOld / nOld)} ms`);
