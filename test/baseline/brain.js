// 决定下哪一步：开局库 → 搜索 → 温度 softmax → 偶尔的失误与弃子。只会从合法走法里选。
import { RED, BLACK, legalMoves, notate, other, apply, revert, attacked, rankOf, fileOf } from "../../src/engine/xiangqi.js";
import { searchRoot, MATE } from "./search.js";
import { evaluate, NEUTRAL, VALUE } from "./evaluate.js";

export const PERSONAS = [
  { key: "cannon", name: "激进炮手", weights: { material: 1, position: 1, mobility: 1, defense: 0.8, attack: 1.5, rookRush: 0.3, cannonCenter: 1.2 }, risk: 0.3, books: { r: ["当头炮", "过宫炮"], b: ["顺炮", "卒底炮"] } },
  { key: "solid", name: "稳守反击", weights: { material: 1.05, position: 1, mobility: 0.9, defense: 1.8, attack: 0.7, rookRush: 0, cannonCenter: 0 }, risk: 0.05, books: { r: ["飞相局", "起马局"], b: ["屏风马", "反宫马"] } },
  { key: "rook", name: "车马冲锋", weights: { material: 1, position: 1, mobility: 1.4, defense: 0.9, attack: 1.2, rookRush: 1, cannonCenter: 0.3 }, risk: 0.2, books: { r: ["当头炮", "仙人指路"], b: ["屏风马", "顺炮"] } },
  { key: "sac", name: "弃子攻杀", weights: { material: 0.85, position: 1.1, mobility: 1.1, defense: 0.7, attack: 1.9, rookRush: 0.5, cannonCenter: 0.6 }, risk: 0.6, books: { r: ["过宫炮", "仙人指路"], b: ["卒底炮", "反宫马"] } },
];

export const BOOKS = {
  当头炮: { side: RED, moves: ["炮二平五", "馬二進三", "車一平二", "馬八進七", "車九平八"] },
  过宫炮: { side: RED, moves: ["炮二平六", "馬二進三", "車一平二", "馬八進七"] },
  飞相局: { side: RED, moves: ["相三進五", "馬二進三", "車一平二", "兵七進一"] },
  仙人指路: { side: RED, moves: ["兵七進一", "炮二平三", "馬二進三", "車一平二"] },
  起马局: { side: RED, moves: ["馬二進三", "兵七進一", "車一平二", "炮八平六"] },
  屏风马: { side: BLACK, moves: ["馬8進7", "馬2進3", "車9平8", "卒7進1"] },
  顺炮: { side: BLACK, moves: ["砲8平5", "馬8進7", "車9進1", "車9平4"] },
  反宫马: { side: BLACK, moves: ["馬2進3", "砲8平6", "馬8進7", "車9平8"] },
  卒底炮: { side: BLACK, moves: ["砲2平3", "馬2進3", "車1平2", "馬8進7"] },
};

export function createArmy(rng, color) {
  const persona = rng.pick(PERSONAS);
  const book = rng.pick(persona.books[color]);
  return { color, persona, book, bookIndex: 0, bookMisses: 0, announced: false };
}

// 胜率：中性评估的 S 形映射，红方视角
export function winRate(board) {
  const s = evaluate(board, RED, NEUTRAL);
  return 1 / (1 + Math.exp(-s / 380));
}

function bookMove(state, army, rng) {
  const book = BOOKS[army.book];
  if (!book || army.bookIndex >= book.moves.length || army.bookMisses >= 2 || state.ply > 12) return null;
  if (army.bookIndex > 0 && rng.chance(0.12)) return null; // 偶尔提前离开定式
  while (army.bookIndex < book.moves.length) {
    const want = book.moves[army.bookIndex++];
    const m = legalMoves(state.board, state.side).find((mm) => notate(state.board, mm) === want);
    if (m) return m;
    army.bookMisses++;
    if (army.bookMisses >= 2) return null;
  }
  return null;
}

// 被吃掉的风险：走到的格子是否被对方攻击
function hanging(board, move) {
  apply(board, move);
  const danger = attacked(board, move.to, other(move.piece[0]));
  revert(board, move);
  return danger;
}

/**
 * 生成器：yield 期间搜索在进行；返回 { move, kind, info }。
 * temperature 0..1；depth 2 或 3。
 */
export function* think(state, army, rng, { temperature = 0.35, depth = 3 } = {}) {
  const color = state.side;
  const book = bookMove(state, army, rng);
  if (book) {
    const first = !army.announced;
    army.announced = true;
    return { move: book, kind: "book", book: army.book, first, roots: null };
  }
  const { roots, nodes } = yield* searchRoot(state, { depth, persona: army.persona.weights });
  if (!roots.length) return null;
  const best = roots[0].score;
  // 已经能将死，或者马上被将死：不再随机
  if (Math.abs(best) > MATE / 2 || temperature <= 0.001) return { move: roots[0].move, kind: "best", roots, nodes };

  // 故意的失误：只有高温下才会出现
  const blunderP = temperature > 0.55 ? (temperature - 0.55) * 0.3 : 0;
  if (roots.length > 4 && rng.chance(blunderP)) {
    const pool = roots.slice(2, Math.min(roots.length, 10)).filter((r) => r.score > -MATE / 2);
    if (pool.length) return { move: rng.pick(pool).move, kind: "blunder", roots, nodes };
  }
  // 出人意料的弃子：分数差不多，却把子送到对方攻击下、并且压向对方九宫
  if (rng.chance(army.persona.risk * 0.12 * (0.5 + temperature))) {
    const enemyPalaceY = color === RED ? 8 : 1;
    const sac = roots.find(
      (r) => r.score > best - 160 && !r.move.captured && VALUE[r.move.piece[1]] >= 270 && Math.abs(rankOf(r.move.to) - enemyPalaceY) <= 2 && Math.abs(fileOf(r.move.to) - 4) <= 2 && hanging(state.board, r.move),
    );
    if (sac) return { move: sac.move, kind: "sacrifice", roots, nodes };
  }
  // 温度 softmax：在若干个最好的走法里按分数加权抽一个
  const tau = 15 + temperature * 140;
  const top = roots.filter((r) => r.score > best - 320).slice(0, 7);
  const weights = top.map((r) => Math.exp((r.score - best) / tau));
  const sum = weights.reduce((a, b) => a + b, 0);
  let u = rng() * sum;
  for (let i = 0; i < top.length; i++) {
    u -= weights[i];
    if (u <= 0) return { move: top[i].move, kind: i === 0 ? "best" : "soft", roots, nodes };
  }
  return { move: top[0].move, kind: "best", roots, nodes };
}
