// 局面评估：子力、位置、机动性、将帅安全、攻势。返回值以 me 方为正，单位约为「分」（车 ≈ 600）。
// 性格 persona 只调整 me 方自己看重什么；对手按中性权重估计。
import { W, H, RED, BLACK, other, fileOf, rankOf, ownSide, findKing, pieceMoves } from "../engine/xiangqi.js";

export const VALUE = { K: 0, A: 120, B: 120, N: 270, R: 600, C: 285, P: 30 };
export const NEUTRAL = { material: 1, position: 1, mobility: 1, defense: 1, attack: 1, rookRush: 0, cannonCenter: 0 };

// 以「前进了几行」和「离中线多远」写成的简单位置表
const adv = (color, y) => (color === RED ? y : 9 - y);
function positional(type, color, x, y) {
  const a = adv(color, y);
  const center = 4 - Math.abs(4 - x);
  switch (type) {
    case "P":
      if (a <= 4) return a === 4 ? 4 : 0;
      return 40 + center * 6 + (a >= 6 && a <= 8 ? 12 : 0) - (a === 9 ? 25 : 0);
    case "N":
      return center * 6 + Math.min(a, 6) * 5 - (x === 0 || x === 8 ? 18 : 0) - (a === 0 ? 10 : 0);
    case "R":
      return Math.min(a, 6) * 3 + (a === 0 ? -12 : 0);
    case "C":
      return (x === 4 ? 14 : 0) + (a === 2 ? 6 : 0) + (a >= 7 ? -6 : 0);
    case "K":
      return -(Math.abs(4 - x) * 8) - (a > 0 ? a * 6 : 0);
    default:
      return 0;
  }
}

const palaceNear = (enemy, x, y) => x >= 2 && x <= 6 && (enemy === RED ? y <= 3 : y >= 6);

function sideTerms(board, color, w) {
  let material = 0, position = 0, mobility = 0, rookRush = 0, cannonCenter = 0, attack = 0;
  let advisors = 0, elephants = 0;
  const enemy = other(color);
  const ek = findKing(board, enemy);
  const ekx = ek >= 0 ? fileOf(ek) : 4;
  const moves = [];
  for (let s = 0; s < board.length; s++) {
    const p = board[s];
    if (!p || p[0] !== color) continue;
    const type = p[1];
    const x = fileOf(s), y = rankOf(s);
    material += type === "P" && !ownSide(color, y) ? 70 : VALUE[type];
    position += positional(type, color, x, y);
    if (type === "A") advisors++;
    if (type === "B") elephants++;
    if (type === "R" || type === "N" || type === "C") {
      moves.length = 0;
      pieceMoves(board, s, moves);
      mobility += type === "R" ? moves.length * 2 : type === "N" ? moves.length * 4 : moves.length;
      if (type === "R") rookRush += Math.min(adv(color, y), 7) * 6 + (adv(color, y) >= 5 ? 20 : 0);
      if (type === "C" && x === 4) cannonCenter += 25;
    }
    // 攻势：进入对方九宫附近的子，越凶的子越值钱
    if (palaceNear(enemy, x, y)) attack += type === "R" ? 45 : type === "N" ? 40 : type === "C" ? 30 : type === "P" ? 22 : 0;
    if (type === "C" && x === ekx) attack += 20; // 炮瞄着对方将线
    if (type === "R" && x === ekx) attack += 15;
  }
  const defense = -(2 - advisors) * 35 - (2 - elephants) * 22;
  return (
    material * w.material +
    position * w.position +
    mobility * w.mobility +
    defense * w.defense +
    attack * w.attack +
    rookRush * w.rookRush +
    cannonCenter * w.cannonCenter
  );
}

export function evaluate(board, me, persona = NEUTRAL) {
  return sideTerms(board, me, persona) - sideTerms(board, other(me), NEUTRAL);
}

export { H, W, BLACK };
