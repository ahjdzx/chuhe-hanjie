// 局面评估：子力 + 兵种位置表 + 机动性 + 将帅安全 + 攻势。返回值以 me 方为正，单位约为「分」（车 ≈ 600）。
// 性格 persona 只调整 me 方自己看重什么；对手按中性权重估计。
import { RED, other, fileOf, rankOf, ownSide, findKing, pieceMoves } from "../engine/xiangqi.js";

export const VALUE = { K: 0, A: 110, B: 110, N: 280, R: 600, C: 290, P: 30 };
export const NEUTRAL = { material: 1, position: 1, mobility: 1, defense: 1, attack: 1, rookRush: 0, cannonCenter: 0 };

// 位置表：行 0 = 己方底线，行 9 = 对方底线；列 0..8 从己方左手边数起（左右对称）
const PST = {
  P: [
    [0, 0, 0, 0, 0, 0, 0, 0, 0],
    [0, 0, 0, 0, 0, 0, 0, 0, 0],
    [0, 0, 0, 0, 0, 0, 0, 0, 0],
    [0, 0, -4, 0, 6, 0, -4, 0, 0],
    [2, 0, 6, 0, 10, 0, 6, 0, 2],
    [10, 16, 24, 30, 32, 30, 24, 16, 10],
    [16, 28, 40, 50, 54, 50, 40, 28, 16],
    [20, 34, 52, 68, 76, 68, 52, 34, 20],
    [18, 36, 56, 76, 90, 76, 56, 36, 18],
    [0, 6, 12, 18, 20, 18, 12, 6, 0],
  ],
  N: [
    [-12, -16, -6, -12, -10, -12, -6, -16, -12],
    [-8, -4, 4, 0, -14, 0, 4, -4, -8],
    [-4, 6, 12, 12, 8, 12, 12, 6, -4],
    [-6, 8, 14, 16, 14, 16, 14, 8, -6],
    [-4, 10, 18, 20, 18, 20, 18, 10, -4],
    [-2, 14, 22, 26, 24, 26, 22, 14, -2],
    [0, 16, 26, 32, 30, 32, 26, 16, 0],
    [0, 18, 30, 36, 30, 36, 30, 18, 0],
    [0, 14, 24, 42, 24, 42, 24, 14, 0],
    [-4, 4, 10, 16, 6, 16, 10, 4, -4],
  ],
  R: [
    [-10, 0, -4, 8, 0, 8, -4, 0, -10],
    [-4, 6, 4, 12, 0, 12, 4, 6, -4],
    [-4, 6, 4, 14, 10, 14, 4, 6, -4],
    [0, 8, 6, 14, 14, 14, 6, 8, 0],
    [4, 12, 10, 16, 16, 16, 10, 12, 4],
    [6, 14, 14, 18, 18, 18, 14, 14, 6],
    [8, 16, 16, 22, 22, 22, 16, 16, 8],
    [10, 20, 20, 28, 28, 28, 20, 20, 10],
    [12, 24, 20, 30, 30, 30, 20, 24, 12],
    [8, 14, 12, 20, 20, 20, 12, 14, 8],
  ],
  C: [
    [0, 0, 4, 8, 8, 8, 4, 0, 0],
    [0, 4, 6, 6, 8, 6, 6, 4, 0],
    [2, 4, 10, 8, 16, 8, 10, 4, 2],
    [0, 0, 0, 0, 6, 0, 0, 0, 0],
    [0, 2, 4, 2, 8, 2, 4, 2, 0],
    [-2, 0, 4, 2, 10, 2, 4, 0, -2],
    [0, 0, 0, 4, 12, 4, 0, 0, 0],
    [2, 2, 0, -6, -4, -6, 0, 2, 2],
    [4, 4, 0, -8, -12, -8, 0, 4, 4],
    [8, 6, 0, -4, -6, -4, 0, 6, 8],
  ],
  K: [
    [0, 0, 0, 4, 10, 4, 0, 0, 0],
    [0, 0, 0, -8, -6, -8, 0, 0, 0],
    [0, 0, 0, -18, -14, -18, 0, 0, 0],
  ],
  A: [
    [0, 0, 0, 0, 0, 0, 0, 0, 0],
    [0, 0, 0, 0, 8, 0, 0, 0, 0],
    [0, 0, 0, -2, 0, -2, 0, 0, 0],
  ],
  B: [
    [0, 0, 0, 0, 0, 0, 0, 0, 0],
    [0, 0, 0, 0, 0, 0, 0, 0, 0],
    [-4, 0, 0, 0, 10, 0, 0, 0, -4],
    [0, 0, 0, 0, 0, 0, 0, 0, 0],
    [0, 0, -2, 0, 0, 0, -2, 0, 0],
  ],
};
const pst = (type, color, x, y) => {
  const row = color === RED ? y : 9 - y;
  const col = color === RED ? x : 8 - x;
  const t = PST[type];
  return t && t[row] ? t[row][col] : 0;
};

const palaceNear = (enemy, x, y) => x >= 2 && x <= 6 && (enemy === RED ? y <= 3 : y >= 6);
const adv = (color, y) => (color === RED ? y : 9 - y);
const moves = [];

function sideTerms(board, color, w) {
  let material = 0, position = 0, mobility = 0, rookRush = 0, cannonCenter = 0, attack = 0;
  let advisors = 0, elephants = 0;
  const enemy = other(color);
  const ek = findKing(board, enemy);
  const ekx = ek >= 0 ? fileOf(ek) : 4;
  for (let s = 0; s < board.length; s++) {
    const p = board[s];
    if (!p || p[0] !== color) continue;
    const type = p[1];
    const x = fileOf(s), y = rankOf(s);
    material += type === "P" && !ownSide(color, y) ? 60 : VALUE[type];
    position += pst(type, color, x, y);
    if (type === "A") advisors++;
    else if (type === "B") elephants++;
    else if (type === "R" || type === "N") {
      moves.length = 0;
      pieceMoves(board, s, moves);
      mobility += type === "R" ? moves.length * 2 : (moves.length - 4) * 5; // 被蹩住的马很亏
      if (type === "R") rookRush += Math.min(adv(color, y), 7) * 6 + (adv(color, y) >= 5 ? 20 : 0);
    } else if (type === "C" && x === 4) cannonCenter += 25;
    if (palaceNear(enemy, x, y)) attack += type === "R" ? 40 : type === "N" ? 36 : type === "C" ? 24 : type === "P" ? 20 : 0;
    if ((type === "C" || type === "R") && x === ekx) attack += type === "C" ? 22 : 14;
  }
  const missing = -((2 - advisors) * 30 + (2 - elephants) * 20);
  return { score: material * w.material + position * w.position + mobility * w.mobility + attack * w.attack + rookRush * w.rookRush + cannonCenter * w.cannonCenter, missing, attack };
}

// 缺士缺象的代价随对方攻势放大：对方在九宫附近没子时只算一半
const exposure = (attack) => 0.5 + Math.min(attack, 160) / 160;

export function evaluate(board, me, persona = NEUTRAL) {
  const a = sideTerms(board, me, persona);
  const b = sideTerms(board, other(me), NEUTRAL);
  return Math.round(a.score + a.missing * exposure(b.attack) * persona.defense - (b.score + b.missing * exposure(a.attack)));
}
