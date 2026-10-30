import { runSync, createMatch, decide, commit } from "../src/game/match.js";
import { searchSync } from "../src/ai/search.js";
import * as X from "../src/engine/xiangqi.js";

let failed = 0;
const ok = (cond, name, extra = "") => {
  if (cond) console.log("  ✓", name, extra);
  else {
    failed++;
    console.log("  ✗", name, extra);
  }
};

console.log("搜索");
{
  // 一步杀：一车封住将门（第 8 行），另一车平到中线将军；两个卒挡住将的左右，无子可垫
  const b = new Array(90).fill(null);
  b[X.sq(4, 0)] = "rK";
  b[X.sq(4, 9)] = "bK";
  b[X.sq(3, 9)] = "bP";
  b[X.sq(5, 9)] = "bP";
  b[X.sq(0, 8)] = "rR";
  b[X.sq(8, 5)] = "rR";
  const g = X.createGame(b, X.RED);
  const { roots } = searchSync(g, { depth: 2 });
  const best = roots[0];
  const after = g.board.slice();
  X.apply(after, best.move);
  const mate = !X.hasLegalMove(after, X.BLACK) && X.inCheck(after, X.BLACK);
  ok(mate, "找到一步杀", X.notate(g.board, best.move));
}
{
  // 白送的车要吃
  const b = X.initialBoard();
  b[X.sq(2, 4)] = "bR"; // 正好在红兵（七路）面前
  const g = X.createGame(b, X.RED);
  const t = Date.now();
  const { roots, nodes } = searchSync(g, { depth: 3 });
  ok(roots[0].move.captured === "bR", "深度 3 吃掉送上门的车", `${X.notate(g.board, roots[0].move)} · ${nodes} 节点 · ${Date.now() - t} ms`);
}

console.log("整盘对局");
const timeA = Date.now();
const a = runSync("SEED01", { depth: 2, temperature: 0.4 });
const msA = Date.now() - timeA;
const a2 = runSync("SEED01", { depth: 2, temperature: 0.4 });
const b = runSync("ZX9Q2K", { depth: 2, temperature: 0.4 });
const line = (m) => m.log.map((e) => e.notation).join(" ");
ok(a.result.over, `SEED01 打完：${a.result.winner ? (a.result.winner === "r" ? "红胜" : "黑胜") : "和"}（${a.result.reason}）`, `${a.log.length} 步 · ${msA} ms`);
ok(line(a) === line(a2), "同一种子复现同一盘棋");
let diverge = 0;
while (diverge < Math.min(a.log.length, b.log.length) && a.log[diverge].notation === b.log[diverge].notation) diverge++;
ok(diverge < 6, `不同种子很快分岔（第 ${diverge + 1} 步起不同）`);
console.log("   SEED01 性格:", a.armies.r.persona.name, a.armies.r.book, "/", a.armies.b.persona.name, a.armies.b.book);
console.log("   ZX9Q2K 性格:", b.armies.r.persona.name, b.armies.r.book, "/", b.armies.b.persona.name, b.armies.b.book);
console.log("   SEED01 前 12 步:", a.log.slice(0, 12).map((e) => e.notation).join(" "));
console.log("   ZX9Q2K 前 12 步:", b.log.slice(0, 12).map((e) => e.notation).join(" "));
console.log("   解说示例:", a.log.slice(0, 40).map((e) => e.comment).filter((c, i, arr) => arr.indexOf(c) === i).slice(0, 8).join(" | "));

console.log("深度 3 单步耗时（中局）");
{
  const m = createMatch("TIMING", { depth: 3, temperature: 0.3 });
  let worst = 0, total = 0, n = 0;
  for (let i = 0; i < 24 && !m.result.over; i++) {
    const t = Date.now();
    const it = decide(m);
    let r = it.next();
    while (!r.done) r = it.next();
    const ms = Date.now() - t;
    worst = Math.max(worst, ms);
    total += ms;
    n++;
    commit(m, r.value);
  }
  ok(worst < 4000, `24 步：平均 ${Math.round(total / n)} ms，最慢 ${worst} ms（分片执行，不阻塞界面）`);
}

console.log(failed ? `\n${failed} 项失败` : "\nAI 全部通过");
process.exitCode = failed ? 1 : 0;
