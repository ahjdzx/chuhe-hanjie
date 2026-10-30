// 中国象棋规则引擎：纯逻辑，不依赖任何渲染库。
// 坐标：x 为列 0..8（红方视角从左到右），y 为行 0..9（红方底线 y = 0，黑方底线 y = 9）。
// 棋子编码为两字符字符串：颜色 r/b + 兵种 K 帥將 A 仕士 B 相象 N 馬 R 車 C 炮 P 兵卒。

export const W = 9;
export const H = 10;
export const RED = "r";
export const BLACK = "b";
export const other = (c) => (c === RED ? BLACK : RED);
export const sq = (x, y) => y * W + x;
export const fileOf = (s) => s % W;
export const rankOf = (s) => (s / W) | 0;
export const onBoard = (x, y) => x >= 0 && x < W && y >= 0 && y < H;
export const inPalace = (color, x, y) => x >= 3 && x <= 5 && (color === RED ? y >= 0 && y <= 2 : y >= 7 && y <= 9);
export const ownSide = (color, y) => (color === RED ? y <= 4 : y >= 5);
export const forward = (color) => (color === RED ? 1 : -1);

export const NAMES = {
  r: { K: "帥", A: "仕", B: "相", N: "馬", R: "車", C: "炮", P: "兵" },
  b: { K: "將", A: "士", B: "象", N: "馬", R: "車", C: "砲", P: "卒" },
};
// 解说用的简体名
export const PLAIN = { K: "帅", A: "士", B: "象", N: "马", R: "车", C: "炮", P: "兵" };
export const PLAIN_SIDE = { r: { K: "帅", A: "仕", B: "相", N: "马", R: "车", C: "炮", P: "兵" }, b: { K: "将", A: "士", B: "象", N: "马", R: "车", C: "炮", P: "卒" } };

const BACK = ["R", "N", "B", "A", "K", "A", "B", "N", "R"];

export function initialBoard() {
  const b = new Array(W * H).fill(null);
  for (let x = 0; x < W; x++) {
    b[sq(x, 0)] = "r" + BACK[x];
    b[sq(x, 9)] = "b" + BACK[x];
  }
  for (const x of [1, 7]) {
    b[sq(x, 2)] = "rC";
    b[sq(x, 7)] = "bC";
  }
  for (const x of [0, 2, 4, 6, 8]) {
    b[sq(x, 3)] = "rP";
    b[sq(x, 6)] = "bP";
  }
  return b;
}

export function keyOf(board, side) {
  let s = side;
  for (let i = 0; i < board.length; i++) s += board[i] ? board[i][1] + (board[i][0] === RED ? "" : "'") : ".";
  return s;
}

export function createGame(board = initialBoard(), side = RED) {
  const state = { board: board.slice(), side, history: [], quiet: 0, ply: 0, seen: new Map() };
  state.seen.set(keyOf(state.board, side), 1);
  return state;
}

export function cloneState(s) {
  return { board: s.board.slice(), side: s.side, history: s.history.slice(), quiet: s.quiet, ply: s.ply, seen: new Map(s.seen) };
}

export function findKing(board, color) {
  const k = color + "K";
  for (let i = 0; i < board.length; i++) if (board[i] === k) return i;
  return -1;
}

const ORTHO = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const DIAG = [[1, 1], [1, -1], [-1, 1], [-1, -1]];
const HORSE = [[1, 2, 0, 1], [-1, 2, 0, 1], [1, -2, 0, -1], [-1, -2, 0, -1], [2, 1, 1, 0], [2, -1, 1, 0], [-2, 1, -1, 0], [-2, -1, -1, 0]];

// 伪合法走法（未检查走后是否被将军）
export function pseudoMoves(board, color, out = []) {
  for (let s = 0; s < board.length; s++) {
    const p = board[s];
    if (!p || p[0] !== color) continue;
    pieceMoves(board, s, out);
  }
  return out;
}

export function pieceMoves(board, s, out = []) {
  const p = board[s];
  const color = p[0];
  const type = p[1];
  const x = fileOf(s);
  const y = rankOf(s);
  const add = (tx, ty) => {
    const t = sq(tx, ty);
    const q = board[t];
    if (q && q[0] === color) return;
    out.push({ from: s, to: t, piece: p, captured: q });
  };
  if (type === "K") {
    for (const [dx, dy] of ORTHO) {
      const tx = x + dx, ty = y + dy;
      if (inPalace(color, tx, ty)) add(tx, ty);
    }
  } else if (type === "A") {
    for (const [dx, dy] of DIAG) {
      const tx = x + dx, ty = y + dy;
      if (inPalace(color, tx, ty)) add(tx, ty);
    }
  } else if (type === "B") {
    for (const [dx, dy] of DIAG) {
      const tx = x + 2 * dx, ty = y + 2 * dy;
      if (!onBoard(tx, ty) || !ownSide(color, ty)) continue;
      if (board[sq(x + dx, y + dy)]) continue; // 塞象眼
      add(tx, ty);
    }
  } else if (type === "N") {
    for (const [dx, dy, lx, ly] of HORSE) {
      const tx = x + dx, ty = y + dy;
      if (!onBoard(tx, ty)) continue;
      if (board[sq(x + lx, y + ly)]) continue; // 蹩马腿
      add(tx, ty);
    }
  } else if (type === "R") {
    for (const [dx, dy] of ORTHO) {
      let tx = x + dx, ty = y + dy;
      while (onBoard(tx, ty)) {
        const q = board[sq(tx, ty)];
        if (!q) out.push({ from: s, to: sq(tx, ty), piece: p, captured: null });
        else {
          if (q[0] !== color) out.push({ from: s, to: sq(tx, ty), piece: p, captured: q });
          break;
        }
        tx += dx;
        ty += dy;
      }
    }
  } else if (type === "C") {
    for (const [dx, dy] of ORTHO) {
      let tx = x + dx, ty = y + dy;
      let screen = false;
      while (onBoard(tx, ty)) {
        const q = board[sq(tx, ty)];
        if (!screen) {
          if (!q) out.push({ from: s, to: sq(tx, ty), piece: p, captured: null });
          else screen = true;
        } else if (q) {
          if (q[0] !== color) out.push({ from: s, to: sq(tx, ty), piece: p, captured: q });
          break;
        }
        tx += dx;
        ty += dy;
      }
    }
  } else if (type === "P") {
    const f = forward(color);
    if (onBoard(x, y + f)) add(x, y + f);
    if (!ownSide(color, y)) {
      if (onBoard(x - 1, y)) add(x - 1, y);
      if (onBoard(x + 1, y)) add(x + 1, y);
    }
  }
  return out;
}

// sq 是否被 by 方攻击（不含将帅对面，那条单独判断）
export function attacked(board, s, by) {
  const x = fileOf(s);
  const y = rankOf(s);
  // 直线：车、炮、将（相邻）
  for (const [dx, dy] of ORTHO) {
    let tx = x + dx, ty = y + dy;
    let seen = 0;
    while (onBoard(tx, ty)) {
      const q = board[sq(tx, ty)];
      if (q) {
        if (seen === 0) {
          if (q[0] === by && (q[1] === "R" || (q[1] === "K" && Math.abs(tx - x) + Math.abs(ty - y) === 1 && inPalace(by, x, y)))) return true;
          seen = 1;
        } else {
          if (q[0] === by && q[1] === "C") return true;
          break;
        }
      }
      tx += dx;
      ty += dy;
    }
  }
  // 马：从马的位置回推，马腿在马的一侧
  for (const [dx, dy] of [[1, 2], [-1, 2], [1, -2], [-1, -2], [2, 1], [2, -1], [-2, 1], [-2, -1]]) {
    const hx = x - dx, hy = y - dy; // 马在 h，走 (dx, dy) 到 s
    if (!onBoard(hx, hy)) continue;
    const q = board[sq(hx, hy)];
    if (q !== by + "N") continue;
    const lx = Math.abs(dx) === 2 ? hx + dx / 2 : hx;
    const ly = Math.abs(dy) === 2 ? hy + dy / 2 : hy;
    if (!board[sq(lx, ly)]) return true;
  }
  // 兵
  const f = forward(by);
  if (onBoard(x, y - f) && board[sq(x, y - f)] === by + "P") return true;
  for (const dx of [-1, 1]) {
    if (!onBoard(x + dx, y)) continue;
    if (board[sq(x + dx, y)] === by + "P" && !ownSide(by, y)) return true;
  }
  // 士
  if (inPalace(by, x, y)) {
    for (const [dx, dy] of DIAG) {
      const tx = x + dx, ty = y + dy;
      if (onBoard(tx, ty) && board[sq(tx, ty)] === by + "A") return true;
    }
  }
  // 象
  if (ownSide(by, y)) {
    for (const [dx, dy] of DIAG) {
      const tx = x + 2 * dx, ty = y + 2 * dy;
      if (onBoard(tx, ty) && board[sq(tx, ty)] === by + "B" && !board[sq(x + dx, y + dy)]) return true;
    }
  }
  return false;
}

export function kingsFacing(board) {
  const r = findKing(board, RED);
  const b = findKing(board, BLACK);
  if (r < 0 || b < 0 || fileOf(r) !== fileOf(b)) return false;
  for (let s = r + W; s < b; s += W) if (board[s]) return false;
  return true;
}

export function inCheck(board, color) {
  const k = findKing(board, color);
  if (k < 0) return true;
  return attacked(board, k, other(color)) || kingsFacing(board);
}

// 在棋盘上直接走/撤（搜索用，不维护历史）
export function apply(board, m) {
  board[m.to] = m.piece;
  board[m.from] = null;
}
export function revert(board, m) {
  board[m.from] = m.piece;
  board[m.to] = m.captured;
}

export function legalMoves(board, color) {
  const out = [];
  for (const m of pseudoMoves(board, color)) {
    apply(board, m);
    if (!inCheck(board, color)) out.push(m);
    revert(board, m);
  }
  return out;
}

export function hasLegalMove(board, color) {
  for (const m of pseudoMoves(board, color)) {
    apply(board, m);
    const ok = !inCheck(board, color);
    revert(board, m);
    if (ok) return true;
  }
  return false;
}

// ---- 有历史的对局 ----------------------------------------------------------------------
export const QUIET_LIMIT = 120; // 连续 120 步（半回合）无吃子判和
export const PLY_LIMIT = 400;
export const REPEAT_LIMIT = 3;

export function play(state, move) {
  const notation = notate(state.board, move);
  apply(state.board, move);
  const side = state.side;
  state.side = other(side);
  state.ply++;
  const quietBefore = state.quiet;
  state.quiet = move.captured ? 0 : state.quiet + 1;
  const key = keyOf(state.board, state.side);
  state.seen.set(key, (state.seen.get(key) || 0) + 1);
  const check = inCheck(state.board, state.side);
  const entry = { ...move, side, notation, check, quietBefore, key };
  state.history.push(entry);
  return entry;
}

export function undo(state) {
  const e = state.history.pop();
  if (!e) return null;
  state.seen.set(e.key, state.seen.get(e.key) - 1);
  if (!state.seen.get(e.key)) state.seen.delete(e.key);
  revert(state.board, e);
  state.side = e.side;
  state.ply--;
  state.quiet = e.quietBefore;
  return e;
}

// 终局判定：将死、困毙（无子可动判负）、重复局面、长时间无吃子
export function outcome(state) {
  const side = state.side;
  if (findKing(state.board, side) < 0) return { over: true, winner: other(side), reason: "将被吃" };
  if (!hasLegalMove(state.board, side)) {
    const check = inCheck(state.board, side);
    return { over: true, winner: other(side), reason: check ? "将死" : "困毙" };
  }
  const last = state.history[state.history.length - 1];
  if (last && (state.seen.get(last.key) || 0) >= REPEAT_LIMIT) return { over: true, winner: null, reason: "三次重复局面" };
  if (state.quiet >= QUIET_LIMIT) return { over: true, winner: null, reason: `${QUIET_LIMIT} 步无吃子` };
  if (state.ply >= PLY_LIMIT) return { over: true, winner: null, reason: `达到 ${PLY_LIMIT} 步上限` };
  return { over: false };
}

// ---- 传统记谱 -------------------------------------------------------------------------
const CN = ["", "一", "二", "三", "四", "五", "六", "七", "八", "九"];
const num = (color, n) => (color === RED ? CN[n] : String(n));
// 纵线编号：红方从右往左一到九，黑方从（黑方的）右往左 1 到 9
export const fileNumber = (color, x) => (color === RED ? 9 - x : x + 1);

export function notate(board, m) {
  const p = m.piece;
  const color = p[0];
  const type = p[1];
  const fx = fileOf(m.from), fy = rankOf(m.from);
  const tx = fileOf(m.to), ty = rankOf(m.to);
  const name = NAMES[color][type];
  // 同一纵线上的同种棋子：前/中/后
  const same = [];
  for (let y = 0; y < H; y++) if (board[sq(fx, y)] === p) same.push(y);
  let head;
  if (same.length >= 2 && !(type === "A" || type === "B")) {
    const order = same.slice().sort((a, b) => (color === RED ? b - a : a - b)); // 越靠前越先
    const i = order.indexOf(fy);
    let tag;
    if (same.length === 2) tag = i === 0 ? "前" : "后";
    else if (same.length === 3) tag = ["前", "中", "后"][i];
    else tag = CN[i + 1];
    head = tag + name;
  } else if (same.length >= 2) {
    // 士象同线时同样用前后
    const order = same.slice().sort((a, b) => (color === RED ? b - a : a - b));
    head = (order.indexOf(fy) === 0 ? "前" : "后") + name;
  } else head = name + num(color, fileNumber(color, fx));
  const dyFwd = (ty - fy) * forward(color);
  if (dyFwd === 0) return head + "平" + num(color, fileNumber(color, tx));
  const act = dyFwd > 0 ? "進" : "退";
  const straight = type === "K" || type === "R" || type === "C" || type === "P";
  const n = straight ? Math.abs(ty - fy) : fileNumber(color, tx);
  return head + act + num(color, n);
}

// ---- 自检 ---------------------------------------------------------------------------
export function perft(board, color, depth) {
  if (depth === 0) return 1;
  let n = 0;
  for (const m of pseudoMoves(board, color)) {
    apply(board, m);
    if (!inCheck(board, color)) n += depth === 1 ? 1 : perft(board, other(color), depth - 1);
    revert(board, m);
  }
  return n;
}

export function selfTest() {
  const b = initialBoard();
  const n = legalMoves(b, RED).length;
  return { ok: n === 44, count: n, expected: 44 };
}
