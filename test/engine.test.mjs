import * as X from "../src/engine/xiangqi.js";

let failed = 0;
const ok = (cond, name, extra = "") => {
  if (cond) console.log("  ✓", name);
  else {
    failed++;
    console.log("  ✗", name, extra);
  }
};
const empty = () => new Array(90).fill(null);
const put = (b, x, y, p) => (b[X.sq(x, y)] = p);
const movesOf = (b, x, y) => X.pieceMoves(b, X.sq(x, y)).map((m) => [X.fileOf(m.to), X.rankOf(m.to)].join(","));
const has = (list, x, y) => list.includes(`${x},${y}`);

console.log("perft（初始局面，标准值 44 / 1920 / 79666）");
const t0 = Date.now();
ok(X.perft(X.initialBoard(), X.RED, 1) === 44, "perft 1 = 44");
ok(X.perft(X.initialBoard(), X.RED, 2) === 1920, "perft 2 = 1920");
const p3 = X.perft(X.initialBoard(), X.RED, 3);
ok(p3 === 79666, "perft 3 = 79666", `got ${p3}`);
console.log(`  (${Date.now() - t0} ms)`);
ok(X.selfTest().ok, "selfTest 通过");

console.log("棋子走法");
{
  const b = empty();
  put(b, 4, 0, "rK"); put(b, 4, 9, "bK"); put(b, 3, 9, "bA");
  put(b, 4, 4, "rN"); put(b, 4, 5, "bP"); // 马腿被堵在前方
  const m = movesOf(b, 4, 4);
  ok(!has(m, 3, 6) && !has(m, 5, 6), "蹩马腿：前方有子，不能跳向前方两点");
  ok(has(m, 2, 5) && has(m, 6, 3), "马的其他方向正常");
}
{
  const b = empty();
  put(b, 4, 0, "rK"); put(b, 3, 9, "bK");
  put(b, 2, 4, "rB");
  let m = movesOf(b, 2, 4);
  ok(!has(m, 0, 6) && !has(m, 4, 6), "相不能过河");
  ok(has(m, 0, 2) && has(m, 4, 2), "相走田字");
  put(b, 3, 3, "bP");
  m = movesOf(b, 2, 4);
  ok(!has(m, 4, 2), "塞象眼");
}
{
  const b = empty();
  put(b, 4, 0, "rK"); put(b, 3, 9, "bK");
  put(b, 3, 0, "rA");
  const m = movesOf(b, 3, 0);
  ok(m.length === 1 && has(m, 4, 1), "仕只能在九宫内斜走");
  const k = movesOf(b, 4, 0);
  ok(!has(k, 4, 0) && has(k, 5, 0) && has(k, 4, 1) && !k.some((s) => s.startsWith("6,")), "帅不出九宫");
}
{
  const b = empty();
  put(b, 4, 0, "rK"); put(b, 3, 9, "bK");
  put(b, 1, 2, "rC"); put(b, 1, 5, "bP"); put(b, 1, 8, "bR"); put(b, 1, 6, "rP");
  const m = movesOf(b, 1, 2);
  ok(has(m, 1, 4) && !has(m, 1, 5), "炮走子同车，被挡即停");
  ok(!has(m, 1, 8), "炮架后第一个是己方子，不能隔两个吃");
  b[X.sq(1, 6)] = null;
  ok(has(movesOf(b, 1, 2), 1, 8), "炮隔一子（炮架）吃子");
}
{
  const b = empty();
  put(b, 4, 0, "rK"); put(b, 3, 9, "bK");
  put(b, 2, 3, "rP");
  ok(movesOf(b, 2, 3).join() === "2,4", "未过河的兵只能向前一步");
  b[X.sq(2, 3)] = null;
  put(b, 2, 5, "rP");
  const m = movesOf(b, 2, 5);
  ok(m.length === 3 && has(m, 1, 5) && has(m, 3, 5) && has(m, 2, 6), "过河兵可左右走，不能后退");
  put(b, 6, 6, "bP");
  ok(movesOf(b, 6, 6).join() === "6,5", "未过河的黑卒向下前进一步");
}
console.log("将帅对面与将军");
{
  const b = empty();
  put(b, 4, 0, "rK"); put(b, 4, 9, "bK"); put(b, 4, 5, "rR");
  const legal = X.legalMoves(b, X.RED).map((m) => `${m.piece}:${X.fileOf(m.to)},${X.rankOf(m.to)}`);
  ok(!legal.some((s) => s.startsWith("rR:") && !s.endsWith(",5") && !s.startsWith("rR:4,")), "车离开中线会造成将帅对面 → 只能沿中线走");
  b[X.sq(4, 5)] = null;
  ok(X.inCheck(b, X.RED) && X.inCheck(b, X.BLACK), "无遮挡的将帅对面视为被将");
  put(b, 3, 0, "rR");
  b[X.sq(3, 0)] = null;
}
{
  // 双车错杀：黑将被将死
  const b = empty();
  put(b, 4, 0, "rK"); put(b, 3, 9, "bK");
  put(b, 0, 9, "rR"); put(b, 1, 8, "rR");
  const g = X.createGame(b, X.BLACK);
  const o = X.outcome(g);
  ok(o.over && o.winner === X.RED && o.reason === "将死", "将死判负", JSON.stringify(o));
}
{
  // 困毙：黑方无子可动且未被将军，判负
  const b = empty();
  put(b, 3, 0, "rK"); put(b, 4, 9, "bK");
  put(b, 3, 8, "rP"); put(b, 5, 8, "rP");
  // 黑将：(3,9) 被兵 (3,8)? 兵从 (3,8) 攻击 (3,9)；(5,9) 被兵 (5,8) 攻击；(4,8) 被车攻击
  const g = X.createGame(b, X.BLACK);
  const check = X.inCheck(b, X.BLACK);
  const o = X.outcome(g);
  ok(!check && o.over && o.winner === X.RED && o.reason === "困毙", "困毙判负", JSON.stringify({ check, o }));
}
console.log("记谱");
{
  const g = X.createGame();
  const find = (s, n) => X.legalMoves(s.board, s.side).find((m) => X.notate(s.board, m) === n);
  const m1 = find(g, "炮二平五");
  ok(!!m1 && X.fileOf(m1.from) === 7 && X.fileOf(m1.to) === 4, "炮二平五");
  X.play(g, m1);
  const m2 = find(g, "馬8進7");
  ok(!!m2 && X.fileOf(m2.from) === 7 && X.fileOf(m2.to) === 6 && X.rankOf(m2.to) === 7, "馬8進7");
  X.play(g, m2);
  ok(!!find(g, "馬二進三") && !!find(g, "兵七進一") && !!find(g, "車一進一") && !!find(g, "相三進一"), "馬二進三 / 兵七進一 / 車一進一 / 相三進一");
  // 前后炮
  const b = empty();
  put(b, 4, 0, "rK"); put(b, 3, 9, "bK"); put(b, 4, 2, "rC"); put(b, 4, 4, "rC"); put(b, 5, 1, "rA");
  const front = X.pieceMoves(b, X.sq(4, 4)).find((m) => X.rankOf(m.to) === 4 && X.fileOf(m.to) === 2);
  ok(X.notate(b, front) === "前炮平七", "前炮平七", X.notate(b, front));
}
console.log("撤销与重复局面");
{
  const g = X.createGame();
  const before = X.keyOf(g.board, g.side);
  const seq = ["車一進一", "車9進1", "車一退一", "車9退1", "車一進一", "車9進1", "車一退一", "車9退1"];
  let entries = 0;
  for (const n of seq) {
    const m = X.legalMoves(g.board, g.side).find((mm) => X.notate(g.board, mm) === n);
    X.play(g, m);
    entries++;
  }
  ok(X.outcome(g).over && X.outcome(g).reason === "三次重复局面", "三次重复局面判和");
  while (entries--) X.undo(g);
  ok(X.keyOf(g.board, g.side) === before && g.ply === 0 && g.history.length === 0, "撤销回到初始局面");
}

console.log(failed ? `\n${failed} 项失败` : "\n规则引擎全部通过");
process.exitCode = failed ? 1 : 0;
