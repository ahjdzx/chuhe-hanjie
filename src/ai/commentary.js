// 每步一句简短解说：只读棋盘，不改变任何状态。
import { RED, PLAIN_SIDE, fileOf, rankOf, sq, onBoard, ownSide, pieceMoves, findKing, other } from "../engine/xiangqi.js";
import { VALUE } from "./evaluate.js";

const SIDE = { r: "红", b: "黑" };
const nm = (p) => SIDE[p[0]] + PLAIN_SIDE[p[0]][p[1]];
const short = (p) => PLAIN_SIDE[p[0]][p[1]];

// 车或炮沿直线牵制：车 → 敌子 → 敌将；炮 → 炮架 → 敌子 → 敌将
function pinOf(board, s) {
  const p = board[s];
  if (!p || (p[1] !== "R" && p[1] !== "C")) return null;
  const x = fileOf(s), y = rankOf(s);
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    const seen = [];
    let tx = x + dx, ty = y + dy;
    while (onBoard(tx, ty) && seen.length < 3) {
      const q = board[sq(tx, ty)];
      if (q) seen.push(q);
      tx += dx;
      ty += dy;
    }
    const enemy = other(p[0]);
    if (p[1] === "R" && seen.length >= 2 && seen[0][0] === enemy && seen[0][1] !== "K" && seen[1] === enemy + "K") return seen[0];
    if (p[1] === "C" && seen.length >= 3 && seen[1][0] === enemy && seen[1][1] !== "K" && seen[2] === enemy + "K") return seen[1];
  }
  return null;
}

// 走后这个子在「捉」谁：攻击到的最有价值、且比自己值钱或无人保护的敌子
function chaseOf(board, s) {
  const p = board[s];
  let best = null;
  for (const m of pieceMoves(board, s)) {
    if (!m.captured || m.captured[1] === "K") continue;
    if (VALUE[m.captured[1]] >= VALUE[p[1]] && (!best || VALUE[m.captured[1]] > VALUE[best[1]])) best = m.captured;
  }
  return best;
}

export function commentFor(boardAfter, entry, choice) {
  const p = entry.piece;
  const me = nm(p);
  const to = entry.to;
  const y = rankOf(to);
  if (choice?.kind === "book" && choice.first) return `${SIDE[p[0]]}方摆出${choice.book}：${entry.notation}`;
  if (entry.captured) {
    const head = entry.captured[1] === "K" ? "绝杀" : "吃子！";
    const line = `${head}${short(p)}吃${short(entry.captured)}`;
    if (choice?.kind === "sacrifice") return line + "，这是一记弃子强攻";
    return entry.check ? line + "，还顺势将军" : line;
  }
  if (entry.check) return `将军！${me}叫将`;
  if (choice?.kind === "sacrifice") return `弃子！${me}冲进九宫，故意送吃换攻势`;
  if (choice?.kind === "blunder") return `${me}这步有些随意，可能是失误`;
  const pinned = pinOf(boardAfter, to);
  if (pinned) return `${me}牵制住了${nm(pinned)}`;
  const chased = chaseOf(boardAfter, to);
  if (chased) return `${me}捉${nm(chased)}`;
  const fromY = rankOf(entry.from);
  if (p[1] === "P" && ownSide(p[0], fromY) && !ownSide(p[0], y)) return `${me}渡河，开始有了横向威胁`;
  if ((p[1] === "R" || p[1] === "N") && ownSide(p[0], fromY) && !ownSide(p[0], y)) return `${me}过河压进`;
  if (p[1] === "R" && (fromY === 0 || fromY === 9)) return `${SIDE[p[0]]}方出车，${entry.notation}`;
  if (p[1] === "N" && (fromY === 0 || fromY === 9)) return `${SIDE[p[0]]}方跳马，${entry.notation}`;
  if (p[1] === "C" && fileOf(to) === 4) return `${SIDE[p[0]]}方架起中炮`;
  if (p[1] === "A") return `${SIDE[p[0]]}方补士，加固九宫`;
  if (p[1] === "B") return `${SIDE[p[0]]}方飞${short(p)}，稳住阵型`;
  if (p[1] === "K") return `${me}挪一步避开锋芒`;
  if (p[1] === "P" && !ownSide(p[0], y)) return `${me}继续向前拱`;
  return `${SIDE[p[0]]}方${entry.notation}`;
}

export function endComment(outcome) {
  if (!outcome.over) return "";
  if (!outcome.winner) return `和棋：${outcome.reason}`;
  return `${outcome.winner === RED ? "红" : "黑"}方胜：${outcome.reason}`;
}

export { findKing };
