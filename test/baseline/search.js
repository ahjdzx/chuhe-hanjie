// 浅层 alpha-beta（负极大值形式）+ 吃子静态搜索。
// 写成生成器：每搜一批节点就 yield 一次，调用方按时间片推进，界面不会卡住。
// 结果只取决于局面、深度和性格，与时间片怎么切无关，所以同一种子可以复现。
import { other, pseudoMoves, apply, revert, inCheck, keyOf } from "../../src/engine/xiangqi.js";
import { evaluate, VALUE } from "./evaluate.js";

export const MATE = 100000;
const SLICE = 1200;

function ordered(board, color) {
  const list = pseudoMoves(board, color);
  for (const m of list) m.order = m.captured ? VALUE[m.captured[1]] * 10 - VALUE[m.piece[1]] + (m.captured[1] === "K" ? 1e6 : 0) : 0;
  list.sort((a, b) => b.order - a.order);
  return list;
}

export function* searchRoot(state, { depth = 3, persona, quiet = 2 } = {}) {
  const board = state.board.slice();
  const me = state.side;
  const ctx = { nodes: 0, persona, me };

  function* quiesce(color, alpha, beta, qd) {
    ctx.nodes++;
    if (ctx.nodes % SLICE === 0) yield;
    const sign = color === me ? 1 : -1;
    const stand = sign * evaluate(board, me, persona);
    if (stand >= beta) return stand;
    if (stand > alpha) alpha = stand;
    if (qd <= 0) return alpha;
    for (const m of ordered(board, color)) {
      if (!m.captured) break;
      apply(board, m);
      if (inCheck(board, color)) {
        revert(board, m);
        continue;
      }
      const v = -(yield* quiesce(other(color), -beta, -alpha, qd - 1));
      revert(board, m);
      if (v >= beta) return v;
      if (v > alpha) alpha = v;
    }
    return alpha;
  }

  function* negamax(color, d, alpha, beta, ply) {
    ctx.nodes++;
    if (ctx.nodes % SLICE === 0) yield;
    if (d === 0) return yield* quiesce(color, alpha, beta, quiet);
    let any = false;
    let best = -Infinity;
    for (const m of ordered(board, color)) {
      apply(board, m);
      if (inCheck(board, color)) {
        revert(board, m);
        continue;
      }
      any = true;
      const v = -(yield* negamax(other(color), d - 1, -beta, -alpha, ply + 1));
      revert(board, m);
      if (v > best) best = v;
      if (v > alpha) alpha = v;
      if (alpha >= beta) break;
    }
    // 无子可走：被将死或困毙，象棋里都判负
    if (!any) return -MATE + ply;
    return best;
  }

  const roots = [];
  for (const m of ordered(board, me)) {
    apply(board, m);
    if (inCheck(board, me)) {
      revert(board, m);
      continue;
    }
    let score;
    const key = keyOf(board, other(me));
    if ((state.seen.get(key) || 0) >= 2) score = 0; // 走成第三次重复 = 和棋
    else score = -(yield* negamax(other(me), depth - 1, -Infinity, Infinity, 1));
    revert(board, m);
    roots.push({ move: m, score });
  }
  roots.sort((a, b) => b.score - a.score);
  return { roots, nodes: ctx.nodes };
}

// 同步跑完（测试用）
export function searchSync(state, opts) {
  const it = searchRoot(state, opts);
  let r = it.next();
  while (!r.done) r = it.next();
  return r.value;
}
