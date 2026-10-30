// alpha-beta（负极大值）+ 置换表 + 杀手/历史着法排序 + 将军延伸 + 吃子静态搜索。
// 写成生成器：每搜一批节点就 yield 一次，调用方按时间片推进，界面不会卡住。
// 结果只取决于局面、深度、性格和窗口，与时间片怎么切无关，所以同一种子可以复现。
import { other, pseudoMoves, apply, revert, inCheck, keyOf, RED } from "../engine/xiangqi.js";
import { evaluate, VALUE, NEUTRAL } from "./evaluate.js";

export const MATE = 100000;
export const CONTEMPT = 25;
const SLICE = 1500;

// ---- Zobrist 哈希（两组 32 位，查表时用第二组校验）---------------------------------------
const CODES = ["rK", "rA", "rB", "rN", "rR", "rC", "rP", "bK", "bA", "bB", "bN", "bR", "bC", "bP"];
const INDEX = Object.fromEntries(CODES.map((c, i) => [c, i]));
const Z1 = new Int32Array(14 * 90);
const Z2 = new Int32Array(14 * 90);
{
  let s = 0x9e3779b9;
  const rnd = () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return s | 0;
  };
  for (let i = 0; i < Z1.length; i++) {
    Z1[i] = rnd();
    Z2[i] = rnd();
  }
}
const SIDE1 = 0x5bd1e995 | 0, SIDE2 = 0x1b873593 | 0;

function hashOf(board, side) {
  let h1 = side === RED ? 0 : SIDE1, h2 = side === RED ? 0 : SIDE2;
  for (let s = 0; s < 90; s++) {
    const p = board[s];
    if (p) {
      h1 ^= Z1[INDEX[p] * 90 + s];
      h2 ^= Z2[INDEX[p] * 90 + s];
    }
  }
  return [h1, h2];
}

// ---- 置换表 ------------------------------------------------------------------------
const TT_BITS = 18;
const TT_SIZE = 1 << TT_BITS;
const EXACT = 1, LOWER = 2, UPPER = 3;

function createTable() {
  return { key: new Int32Array(TT_SIZE), depth: new Int8Array(TT_SIZE), score: new Int32Array(TT_SIZE), flag: new Int8Array(TT_SIZE), move: new Int16Array(TT_SIZE).fill(-1) };
}

const enc = (m) => m.from * 90 + m.to;

export function* searchRoot(state, { depth = 3, persona = NEUTRAL, quiet = 4, margin = 0 } = {}) {
  const board = state.board.slice();
  const me = state.side;
  const tt = createTable(); // 每步新建，保证可复现（不受上一步残留影响）
  const killers = [];
  const history = new Int32Array(90 * 90);
  let nodes = 0;
  let [h1, h2] = hashOf(board, me);

  const doMove = (m) => {
    const pi = INDEX[m.piece] * 90;
    h1 ^= Z1[pi + m.from] ^ Z1[pi + m.to] ^ SIDE1;
    h2 ^= Z2[pi + m.from] ^ Z2[pi + m.to] ^ SIDE2;
    if (m.captured) {
      const ci = INDEX[m.captured] * 90 + m.to;
      h1 ^= Z1[ci];
      h2 ^= Z2[ci];
    }
    apply(board, m);
  };
  const undoMove = (m) => {
    revert(board, m);
    const pi = INDEX[m.piece] * 90;
    h1 ^= Z1[pi + m.from] ^ Z1[pi + m.to] ^ SIDE1;
    h2 ^= Z2[pi + m.from] ^ Z2[pi + m.to] ^ SIDE2;
    if (m.captured) {
      const ci = INDEX[m.captured] * 90 + m.to;
      h1 ^= Z1[ci];
      h2 ^= Z2[ci];
    }
  };

  function order(list, hashMove, ply) {
    const k = killers[ply] || [];
    for (const m of list) {
      const e = enc(m);
      if (e === hashMove) m.order = 1e9;
      else if (m.captured) m.order = 1e7 + VALUE[m.captured[1]] * 16 - VALUE[m.piece[1]] + (m.captured[1] === "K" ? 1e8 : 0);
      else if (e === k[0]) m.order = 9e6;
      else if (e === k[1]) m.order = 8e6;
      else m.order = history[e];
    }
    list.sort((a, b) => b.order - a.order);
    return list;
  }

  function* quiesce(color, alpha, beta, qd) {
    nodes++;
    if (nodes % SLICE === 0) yield;
    const stand = (color === me ? 1 : -1) * evaluate(board, me, persona);
    if (stand >= beta) return stand;
    if (stand > alpha) alpha = stand;
    if (qd <= 0) return alpha;
    const caps = pseudoMoves(board, color).filter((m) => m.captured);
    caps.sort((a, b) => VALUE[b.captured[1]] * 16 - VALUE[b.piece[1]] - (VALUE[a.captured[1]] * 16 - VALUE[a.piece[1]]));
    for (const m of caps) {
      if (m.captured[1] === "K") return MATE; // 能吃将：上一步是送将
      // 差值剪枝：吃到也追不上 alpha 的子不必看
      if (stand + VALUE[m.captured[1]] + 200 < alpha) continue;
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
    nodes++;
    if (nodes % SLICE === 0) yield;
    const checked = inCheck(board, color);
    if (checked && ply < 12) d++; // 将军延伸：被将时多看一层，避免看漏杀棋
    if (d <= 0) return yield* quiesce(color, alpha, beta, quiet);

    const slot = h1 & (TT_SIZE - 1);
    let hashMove = -1;
    if (tt.key[slot] === h2) {
      hashMove = tt.move[slot];
      if (tt.depth[slot] >= d) {
        let sc = tt.score[slot];
        if (sc > MATE - 1000) sc -= ply;
        else if (sc < -MATE + 1000) sc += ply;
        const f = tt.flag[slot];
        if (f === EXACT) return sc;
        if (f === LOWER && sc >= beta) return sc;
        if (f === UPPER && sc <= alpha) return sc;
      }
    }

    const alpha0 = alpha;
    let best = -Infinity;
    let bestMove = -1;
    let any = false;
    for (const m of order(pseudoMoves(board, color), hashMove, ply)) {
      doMove(m);
      if (inCheck(board, color)) {
        undoMove(m);
        continue;
      }
      any = true;
      const v = -(yield* negamax(other(color), d - 1, -beta, -alpha, ply + 1));
      undoMove(m);
      if (v > best) {
        best = v;
        bestMove = enc(m);
      }
      if (v > alpha) alpha = v;
      if (alpha >= beta) {
        if (!m.captured) {
          const k = (killers[ply] = killers[ply] || [-1, -1]);
          if (k[0] !== enc(m)) {
            k[1] = k[0];
            k[0] = enc(m);
          }
          history[enc(m)] += d * d;
        }
        break;
      }
    }
    // 无子可走：被将死或困毙，象棋里都判负（越早被杀越糟）
    if (!any) return -MATE + ply;

    let store = best;
    if (store > MATE - 1000) store += ply;
    else if (store < -MATE + 1000) store -= ply;
    tt.key[slot] = h2;
    tt.depth[slot] = d;
    tt.score[slot] = store;
    tt.flag[slot] = best <= alpha0 ? UPPER : best >= beta ? LOWER : EXACT;
    tt.move[slot] = bestMove;
    return best;
  }

  // 根节点：先用浅一层的结果给着法排序，再逐个搜。
  // 第一个着法全窗口；之后的着法窗口下沿 = 当前最好 − margin，落在窗口外的只知道「不够好」（exact = false）。
  const legal = [];
  for (const m of pseudoMoves(board, me)) {
    apply(board, m);
    const ok = !inCheck(board, me);
    revert(board, m);
    if (ok) legal.push(m);
  }
  let roots = legal.map((move) => ({ move, score: 0, exact: true }));
  for (let iter = Math.min(2, depth); iter <= depth; iter++) {
    let best = -Infinity;
    const next = [];
    for (const r of roots) {
      const m = r.move;
      const key = (doMove(m), keyOf(board, other(me)));
      let score, exact = true;
      if ((state.seen.get(key) || 0) >= 2) score = -CONTEMPT; // 走成第三次重复 = 和棋；略看低和棋，占优的一方就会主动避开
      else {
        const floor = best === -Infinity ? -Infinity : best - margin - 1;
        score = -(yield* negamax(other(me), iter - 1, -Infinity, -floor, 1));
        if (floor !== -Infinity && score <= floor) exact = false;
      }
      undoMove(m);
      if (score > best) best = score;
      next.push({ move: m, score, exact });
    }
    next.sort((a, b) => b.score - a.score || (b.exact ? 1 : 0) - (a.exact ? 1 : 0));
    roots = next;
  }
  return { roots, nodes };
}

// 同步跑完（测试用）
export function searchSync(state, opts) {
  const it = searchRoot(state, opts);
  let r = it.next();
  while (!r.done) r = it.next();
  return r.value;
}

// 中性的「安静局面」估值：把能立刻发生的吃子交换算完再看分，给胜率条用（红方视角）
export function settledScore(board, side) {
  const b = board.slice();
  let n = 0;
  function q(color, alpha, beta, qd) {
    n++;
    const stand = (color === RED ? 1 : -1) * evaluate(b, RED, NEUTRAL);
    if (stand >= beta || qd <= 0 || n > 4000) return Math.max(stand, alpha);
    if (stand > alpha) alpha = stand;
    for (const m of pseudoMoves(b, color)) {
      if (!m.captured) continue;
      if (m.captured[1] === "K") return MATE;
      apply(b, m);
      if (inCheck(b, color)) {
        revert(b, m);
        continue;
      }
      const v = -q(other(color), -beta, -alpha, qd - 1);
      revert(b, m);
      if (v >= beta) return v;
      if (v > alpha) alpha = v;
    }
    return alpha;
  }
  const v = q(side, -Infinity, Infinity, 4);
  return side === RED ? v : -v;
}
