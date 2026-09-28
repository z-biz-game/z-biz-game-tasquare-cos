#!/usr/bin/env node
// 规则语义闸 · Tasquare 的词汇表、几何引理与"什么算合法"逐条钉死
//
// 存在理由：本仓所有下游（裁判 counter.js、铅笔 pencil.js、后面的出题器与页面）都从
// js/engine/rules.js 读**同一份**候选方形表。这份统一是本仓相对筛选屏唯一的结构性改动，
// 而它带来的风险恰好是"一起自洽地错"：几何若写歪，裁判数出的"唯一解"和铅笔给出的
// "零猜测推完"就再也不是对同一批盘形的两个断言 —— 而出货条件需要这两个断言同时成立。
// 所以每条结论都由**另一条通道**对照：本文件自己按 Cross+A 的引文重写一遍方形枚举
// （enumerateSquares 下面那份朴素实现），或拿极大分量判定对着声明式分解撞。
//
// 跑法：  node tools/rule-test.mjs
//
// 每段都写了"什么改动会让这段红"，因为一条不会被推翻的断言等于没写：
//
//   §1 文本形式        makeFace 放开多位数 token / 拒绝 '.'、'?' 之外的非法串 / faceTokens
//                      与 makeFace 不再是互逆 —— 会红。两位数线索是本题材的**必需**能力
//                      （8x8 上数字能到 12），筛选屏那版按单字符解析、把 >9 的线索直接丢掉，
//                      等于悄悄改了题面密度。
//   §2 几何引理        穷举 6x6/6x7/7x6/7x7 全部（实心方形, 外部格）配对，要求"沿多于一条边
//                      相碰"= 0 例。这一条是 [R4] 子集和"精确而非松弛"的**唯一**依据；
//                      把它写成注释而不写成断言，将来 readA 分岔时就没人报警。
//   §3 方形表          手算的 3x3 空盘 14 个方形 / 中心印线索后 8 个 / B=off 时 5 个；
//                      ofCell 与 ofTopLeft 的互相归属；nbFree 里出现线索格或 nbClue 漏配 —— 会红。
//                      并与本文件那份朴素枚举逐格对撞（同 readA/allowSingle 下必须逐字节同集合）。
//   §4 合法定义        R1..R6 + R2b 每条各一个"只在这一点上坏"的负样本 + 一个只差一点的正样本；
//                      "被涂黑的线索只报 R1、不级联出假 R4/R5"也被单独钉住。
//   §5 两种判定的分歧   同一张涂黑用声明式 verifyAreas 能打出 R3，用极大分量 verify() 打不出
//                      （两区并成一个非方形分量，只剩 R2）。这条不对称是**刻意保留**的，
//                      谁把 verifyAreas 改成 verify 的别名就会红。
//   §6 三种读法        同一个 2x2 碰一条线索：area=4、wrap=4、contact=1；且裁判的 wrapDup
//                      在一个小盘上必须恒 0（引理的下游证人）。
//   §7 铅笔的自证       两面：3 条线索的薄基盘上零猜测铅笔**必须**留下未知格（它若"推完了"
//                      就是在编答案）；把同一张几何的读数全印出来 = 满线索对照盘，那里必须
//                      done、legalIfDone=0、推完的黑格集合逐格等于真解、P1clueWhite 打满 31 格。
//   §8 负控            往账本里伪造 25 条结论 → auditLedger 必须一条不漏地抓出；
//                      把 25 个错色当**已知条件**喂进引擎 → 必须留下可见痕迹（矛盾 > 0 且
//                      done=false）。证人若只会对真值点头，这两条就是它的死刑判决。
//   §9 一份几何两个消费者  同一张题面上裁判的 MRV 序与行序必须数出同一个 count、两者的方形表
//                      计数必须与铅笔同源；且在唯一解那张（满线索对照盘）上铅笔零猜测推完的
//                      涂黑必须逐格等于裁判交回的那一个解。共享 squareTable() 之后最容易坏的就是这条。

import {
  FREE, QMARK, UNK, BLK, WHT, DEFAULTS, makeFace, cloneFace, faceTokens, faceRows,
  blacksOf, neighbours, components, squareTable, contribOf, clueReading, whitesConnected,
  verify, verifyAreas, areasToBlacks,
} from '../js/engine/rules.js';
import { countSolutions, auditSolutions } from '../js/engine/counter.js';
import { pencilSolve, auditLedger, auditState, RULES } from '../js/engine/pencil.js';

console.log('================================================================================');
console.log('TASQUARE RULE-TEST — 词汇表 / 几何引理 / 合法定义 / 两个消费者共用一份几何');
console.log(`node ${process.version} · readA=${DEFAULTS.readA} allowSingle=${DEFAULTS.allowSingle} printZero=${DEFAULTS.printZero}`);
console.log('================================================================================');

let checks = 0, fails = 0;
const ok = (gate, cond, detail = '') => {
  checks++;
  if (!cond) fails++;
  console.log(`  ${cond ? 'ok  ' : 'FAIL'} ${gate} :: ${detail}`);
};
const eq = (gate, got, want) => ok(gate, got === want, `期望 ${JSON.stringify(want)}，实得 ${JSON.stringify(got)}`);

// 基盘：6x6，解 = (0,0) 处 2x2 + (3,3) 处 1x1；线索按 readA='area' 现算出来印着。
const BASE_ROWS = ['. . 4 . . .', '. . . . . .', '. . . . . .', '. . ? . . .', '. . . . . .', '. . . . . 0'];
const BASE_CELLS = [[0, 0], [0, 1], [1, 0], [1, 1], [3, 3]];
const baseFace = () => makeFace(BASE_ROWS);
const baseBlacks = () => blacksOf(BASE_CELLS, 6, 6);
/** 满线索对照盘：同一张几何，把**每个**白格的读数现算出来印上（不是手打题面）。
 *  clueReading 只从题面取 h/w，所以边写边读不会互相污染，形状与填写顺序无关。 */
function printAllReadings(cells, h = 6, w = 6) {
  const f = makeFace(Array.from({ length: h }, () => Array.from({ length: w }, () => '.')));
  const bs = blacksOf(cells, h, w);
  for (let i = 0; i < h * w; i++) if (!bs[i]) f.c[i] = clueReading(f, i, bs, DEFAULTS).sum;
  return f;
}
const mut = (rows, r, j, ch) => { const cp = rows.slice(); cp[r] = cp[r].split(/\s+/); cp[r][j] = ch; return cp.map((x) => (Array.isArray(x) ? x : x.split(/\s+/))); };

// ---------------------------------------------------------------- §1 文本形式
console.log('\n[§1 题面文本形式]');
{
  const f = makeFace(['. . 12', '? . .', '0 . .']);
  eq('§1 多位数 token 解析', f.c[2], 12);
  eq('§1 问号 token', f.c[3], QMARK);
  eq('§1 印出的 0 是合法数字线索', f.c[6], 0);
  eq('§1 空格', f.c[0], FREE);
  ok('§1 行必须等宽', (() => { try { makeFace(['. .', '. . .']); return false; } catch { return true; } })(), 'ragged rows 必须抛');
  ok('§1 非法 token 必须抛', (() => { try { makeFace(['. x .']); return false; } catch { return true; } })(), '字母 token 不该被当成 0');
  ok('§1 负数 token 必须抛', (() => { try { makeFace(['-3 .']); return false; } catch { return true; } })(), '-3 既不是 FREE 也不是 QMARK');
  const rt = makeFace(faceRows(baseFace()));
  ok('§1 makeFace ∘ faceTokens 是恒等', faceRows(rt).join('|') === faceRows(baseFace()).join('|'), faceRows(baseFace()).join('|'));
  const g = cloneFace(baseFace());
  g.c[0] = 9;
  ok('§1 cloneFace 是深拷贝', baseFace().c[0] === FREE && g.c[0] === 9, `原盘 c[0]=${baseFace().c[0]} 副本 c[0]=${g.c[0]}`);
  ok('§1 题面形状是 {h,w,c}', baseFace().h === 6 && baseFace().w === 6 && baseFace().c.length === 36, 'h/w/c 三者必须自洽');
}

// ---------------------------------------------------------------- §2 几何引理
console.log('\n[§2 几何引理：一个实心方形碰外部格至多一条边]');
{
  let counter = 0, examined = 0;
  for (const h of [6, 7]) for (const w of [6, 7]) {
    for (let s = 1; s <= Math.min(h, w); s++) for (let r = 0; r + s <= h; r++) for (let j = 0; j + s <= w; j++) {
      const bs = new Uint8Array(h * w);
      for (let a = r; a < r + s; a++) for (let cq = j; cq < j + s; cq++) bs[a * w + cq] = 1;
      const outs = new Set();
      for (let a = r; a < r + s; a++) for (let cq = j; cq < j + s; cq++) for (const q of neighbours(a * w + cq, h, w)) if (!bs[q]) outs.add(q);
      for (const p of outs) {
        let adj = 0;
        for (const q of neighbours(p, h, w)) if (bs[q]) adj++;
        examined++;
        if (adj > 1) counter++;
      }
    }
  }
  ok('§2 反例数 == 0', counter === 0, `穷举 ${examined} 个（实心方形, 外部格）配对，沿多于一条边相碰 = ${counter} 例`);
  ok('§2 穷举规模不小于筛选屏那次', examined >= 3052, `本闸 ${examined} 例 vs 筛选屏 3,052 例`);
  // 引理的正面形状：3x3 空盘里一个 2x2 区的每个外部邻格，恰碰到一条黑边
  const f = makeFace(['. . .', '. . .', '. . .']);
  const T = squareTable(f);
  const sq22 = T.squares.find((x) => x.side === 2 && x.cells[0] === 0);
  let touches = [];
  if (sq22) for (const i of sq22.cells) for (const q of neighbours(i, 3, 3)) if (!sq22.cells.includes(q)) touches.push([q, neighbours(q, 3, 3).filter((z) => sq22.cells.includes(z)).length]);
  ok('§2 2x2 的每个外部邻格恰碰一条边', touches.every(([, k]) => k === 1), `${touches.length} 个邻格：${touches.map(([i, k]) => `${i}:${k}`).join(' ')}`);
}

// ---------------------------------------------------------------- §3 方形表
console.log('\n[§3 候选方形表 squareTable（朴素枚举做对照通道）]');
/** 本文件自己按引文重写一遍：实心轴对齐正方形、不含线索格 */
function enumerateSquares(rows, allowSingle) {
  const h = rows.length, w = rows[0].length;
  const isClue = (r, j) => rows[r][j] !== '.';
  const out = [];
  const maxSide = Math.min(h, w);
  for (let s = allowSingle ? 1 : 2; s <= maxSide; s++) {
    for (let r = 0; r + s <= h; r++) for (let j = 0; j + s <= w; j++) {
      let bad = false;
      for (let a = r; a < r + s && !bad; a++) for (let cq = j; cq < s + j; cq++) if (isClue(a, cq)) { bad = true; break; }
      if (bad) continue;
      const cells = [];
      for (let a = r; a < r + s; a++) for (let cq = j; cq < j + s; cq++) cells.push(a * w + cq);
      const inside = new Set(cells);
      const nb = new Set(), nbFree = new Set(), nbClue = new Map();
      for (const i of cells) for (const q of neighbours(i, h, w)) {
        if (inside.has(q)) continue;
        nb.add(q);
        if (isClue((q / w) | 0, q % w)) { if (!nbClue.has(q)) nbClue.set(q, i); } else nbFree.add(q);
      }
      out.push({ cells, side: s, size: s * s, nb: [...nb], nbFree: [...nbFree], nbClue: [...nbClue.entries()] });
    }
  }
  return out;
}
{
  const empty = makeFace(['. . .', '. . .', '. . .']);
  eq('§3 3x3 空盘方形数（1..3 边长全开）', squareTable(empty).squares.length, 14);
  eq('§3 B=off 时 3x3 空盘方形数', squareTable(empty, { allowSingle: false }).squares.length, 5);
  const mid = makeFace(['. . .', '. 5 .', '. . .']);
  eq('§3 中心印线索后只剩 8 个（凡含中心的都死）', squareTable(mid).squares.length, 8);
  eq('§3 基盘方形数', squareTable(baseFace()).squares.length, (() => {
    const rows = BASE_ROWS.map((r) => r.split(/\s+/));
    return enumerateSquares(rows, true).length;
  })());

  // 与朴素枚举逐格对撞（三张盘 × 两种 B 开关）
  let agree = 0, vs = 0;
  for (const f of [baseFace(), empty, mid, makeFace(['. . 4 .', '. . . .', '. ? . 0', '. . . .'])]) {
    for (const allowSingle of [true, false]) {
      vs++;
      const T = squareTable(f, { allowSingle });
      const P = enumerateSquares(faceTokens(f), allowSingle);
      const key = (list) => list.map((x) => `${x.side}|${x.cells.join(',')}|${[...x.nb].sort((a, b) => a - b).join(',')}|${x.nbFree.length}|${x.nbClue}`).sort().join('||');
      const a = key(T.squares.map((x) => ({ side: x.side, cells: x.cells, nb: x.nb, nbFree: x.nbFree, nbClue: x.nbClue.map((t) => `${t.p}:${t.cell}`) })));
      const b = key(P.map((x) => ({ side: x.side, cells: x.cells, nb: x.nb, nbFree: x.nbFree, nbClue: x.nbClue.map(([p, cell]) => `${p}:${cell}`) })));
      if (a === b) agree++;
      else console.log(`      分歧 readA 无关的方形表：盘 ${faceRows(f).join(' / ')} allowSingle=${allowSingle}`);
    }
  }
  eq('§3 squareTable 与朴素枚举逐格一致', agree, vs);

  const T = squareTable(baseFace());
  ok('§3 ofCell 归属双向一致', T.squares.every((x) => x.cells.every((i) => T.ofCell[i].includes(x.id)))
    && T.ofCell.every((list, i) => list.every((id) => T.squares[id].cells.includes(i))), 'ofCell 与 squares.cells 必须互认');
  ok('§3 ofTopLeft 恰是左上角', T.squares.every((x) => {
    const r = (x.cells[0] / baseFace().w) | 0, j = x.cells[0] % baseFace().w;
    return T.ofTopLeft[r * baseFace().w + j].includes(x.id);
  }), '每个方形都挂在它的左上角格下');
  ok('§3 方形内部永不含线索格（R1 直接切候选空间）', T.squares.every((x) => x.cells.every((i) => baseFace().c[i] === FREE)), '判据 2 便宜的全部原因就在这条');
  ok('§3 nbFree 里没有线索格 · nbClue 里全是线索格', T.squares.every((x) => x.nbFree.every((i) => baseFace().c[i] === FREE) && x.nbClue.every((t) => baseFace().c[t.p] !== FREE)));
  ok('§3 nb == nbFree ∪ nbClue 且两两不重叠', T.squares.every((x) => {
    const cl = new Set(x.nbClue.map((t) => t.p));
    return x.nb.length === new Set(x.nb).size
      && x.nb.every((i) => cl.has(i) || x.nbFree.includes(i))
      && x.nbFree.every((i) => !cl.has(i))
      && cl.size + x.nbFree.length === x.nb.length;
  }), '外部邻格的三分必须完备且互斥');
  ok('§3 一个方形碰同一线索至多一条边（引理在表里的形状）', T.squares.every((x) => new Set(x.nbClue.map((t) => t.p)).size === x.nbClue.length), 'nbClue 按线索格去重后条数不变');
}

// ---------------------------------------------------------------- §4 合法定义
console.log('\n[§4 六条条款 + B 开关变体：每条一个负样本、一个差一点的正样本]');
{
  const codes = (f, bs, o) => [...new Set(verify(f, bs, o).map((v) => v.code))].sort().join(',');
  const base = baseFace(), baseB = baseBlacks();
  eq('§4 P0 基盘合法', codes(base, baseB), '');
  eq('§4 N1 [R1] 线索格被涂黑', codes(base, blacksOf([...BASE_CELLS, [5, 5]], 6, 6)), 'R1');
  eq('§4 P1 修回去就合法', codes(base, baseB), '');
  eq('§4 N2 [R2] 两格 domino 不是方形', codes(base, blacksOf([...BASE_CELLS, [5, 0], [5, 1]], 6, 6)), 'R2');
  eq('§4 P2 只留一个 1x1 就合法', codes(base, blacksOf([...BASE_CELLS, [5, 0]], 6, 6)), '');
  eq('§4 N4 [R4] 圈内数字与邻区格数之和不符', codes(makeFace(mut(BASE_ROWS, 0, 2, '3')), baseB), 'R4');
  eq('§4 P4 改回 4 就合法', codes(base, baseB), '');
  const f5 = makeFace(['. . 4 . . .', '. . . . . .', '. . . . . .', '. . . . . .', '. . . . . .', '? . . . . 0']);
  eq('§4 N5 [R5] 问号没有邻黑格', codes(f5, baseB), 'R5');
  const f6 = makeFace(['. . .', '. . .', '. . .']);
  eq('§4 N6 [R6] 两个对角 1x1 把白格切开', codes(f6, blacksOf([[0, 1], [1, 0]], 3, 3)), 'R6');
  eq('§4 P6 只留一个 1x1 白格就连通', codes(f6, blacksOf([[0, 1]], 3, 3)), '');
  eq('§4 N7 [R2b] B=off 时 1x1 不算方形区', codes(base, baseB, { allowSingle: false }), 'R2b');
  eq('§4 P7 B=on（默认）合法', codes(base, baseB, { allowSingle: true }), '');
  // 全黑盘没有白格：R6 的另一种形状（"白格集合为空"），不许被合并进"不连通"
  const allBlack = makeFace(['. .', '. .']);
  ok('§4 [R6] 空白格集用独立措辞', (() => {
    const V = verify(allBlack, new Uint8Array([1, 1, 1, 1]));
    return V.some((v) => v.code === 'R6' && v.msg === 'R6 no-white-cells');
  })(), verify(allBlack, new Uint8Array([1, 1, 1, 1])).map((v) => v.msg).join(' '));
  // 级联抑制：被涂黑的线索格自己**不再**产生假 R4/R5。
  // A：把印 0 的 (5,5) 涂黑 —— 它自己是一个合法的 1x1 区，所以除了 R1 什么都不该报。
  const cascade = verify(base, blacksOf([...BASE_CELLS, [5, 5]], 6, 6));
  ok('§4 被涂黑的线索只报 R1 不级联假 R4', cascade.every((v) => v.code === 'R1') && cascade.length === 1, cascade.map((v) => v.msg).join(' '));
  // B：把印 4 的 (0,2) 涂黑 —— 它与 (1,2) 并成一个 1x2 domino，所以 R1 + R2 都该报，
  //    但 R4 不该因为"这个线索被黑了"而复报（否则一个坏格会级联出假读数）。
  const cascade2 = [...new Set(verify(base, blacksOf([...BASE_CELLS, [0, 2], [1, 2]], 6, 6), {}).map((v) => v.code))].sort().join(',');
  eq('§4 同一格的 R1 与 R2 各报一次、R4 不复报', cascade2, 'R1,R2');
  // 一条 clause 一个 code，msg 带坐标
  const v1 = verify(base, blacksOf([...BASE_CELLS, [5, 5]], 6, 6))[0];
  ok('§4 违规记录形状 = {code,msg} 且 msg 带 @坐标', v1.code === 'R1' && /@\d+,\d+/.test(v1.msg), JSON.stringify(v1));
}

// ---------------------------------------------------------------- §5 两种判定的分歧
console.log('\n[§5 声明式分解 vs 极大分量：R3 只在声明式这边可反证]');
{
  const f2 = baseFace();
  const ar = verifyAreas(f2, [{ r: 0, j: 0, s: 2 }, { r: 2, j: 1, s: 1 }]);
  const declared = [...new Set(ar.violations.map((v) => v.code))].sort().join(',');
  ok('§5 verifyAreas 抓得住共边的两区（R3）', declared.includes('R3'), declared);
  const maximal = [...new Set(verify(f2, ar.blacks).map((v) => v.code))].sort().join(',');
  ok('§5 同一张涂黑用极大分量打不出 R3（并成非方形分量只剩 R2）', !maximal.includes('R3') && maximal.includes('R2'), maximal);
  const ar2 = verifyAreas(f2, [{ r: 0, j: 0, s: 2 }, { r: 3, j: 3, s: 1 }]);
  eq('§5 只对角相接的两区合法', ar2.violations.length, 0);
  eq('§5 areasToBlacks 与 verifyAreas 同一份 blacks', areasToBlacks(f2, [{ r: 0, j: 0, s: 2 }]).reduce((a, x) => a + x, 0), 4);
  const overlap = verifyAreas(f2, [{ r: 0, j: 0, s: 2 }, { r: 1, j: 1, s: 2 }]);
  ok('§5 两区共享格子报 R2', overlap.violations.some((v) => v.code === 'R2'), overlap.violations.map((v) => v.code).join(','));
  const onClue = verifyAreas(f2, [{ r: 0, j: 2, s: 1 }]);
  ok('§5 声明的区盖住线索格报 R1', onClue.violations.some((v) => v.code === 'R1'), onClue.violations.map((v) => v.code).join(','));
  const off = verifyAreas(makeFace(['. . .', '. . .', '. . .']), [{ r: 2, j: 2, s: 2 }]);
  ok('§5 出格的区报 R2 而不是崩掉', off.violations.some((v) => v.code === 'R2'), off.violations.map((v) => v.msg).join(' '));
}

// ---------------------------------------------------------------- §6 三种读法
console.log('\n[§6 clueReading：area / wrap / contact]');
{
  const base = baseFace(), baseB = baseBlacks();
  const p = 2;                                  // 印着 4 的那格 (0,2)
  const a = clueReading(base, p, baseB, { readA: 'area' });
  const b = clueReading(base, p, baseB, { readA: 'wrap' });
  const c = clueReading(base, p, baseB, { readA: 'contact' });
  eq('§6 area 读到 2x2 的面积', a.sum, 4);
  eq('§6 wrap 与 area 恒等（引理的下游）', b.sum, a.sum);
  eq('§6 contact 读到邻黑格个数', c.sum, 1);
  eq('§6 area 的 touched/areas', `${a.touched}/${a.areas}`, 'true/1');
  eq('§6 contact 的邻黑格数', c.contact, 1);
  const zero = clueReading(base, 35, baseB, { readA: 'area' });   // 印着 0 的 (5,5)
  ok('§6 印 0 的线索确实读到 0 且没碰任何黑区', zero.sum === 0 && zero.touched === false, `sum=${zero.sum} touched=${zero.touched}`);
  // 一条线索被**两个不同的区**各碰一条边：area 读面积和、contact 读邻黑格数、区数 2。
  // 盘面：4x4，2x2 区在 (0,0)，1x1 区在 (3,0)，线索印在 (2,0) —— 它的四个邻格里
  // (1,0) 属 2x2、(3,0) 是那个 1x1，另外两格是空格。
  const two = makeFace(['. . . .', '. . . .', '5 . . .', '. . . .']);
  const twoB = blacksOf([[0, 0], [0, 1], [1, 0], [1, 1], [3, 0]], 4, 4);
  const t1 = clueReading(two, 8, twoB, { readA: 'area' });
  ok('§6 两区相碰一条线索：area 求面积和、区数正确', t1.sum === 5 && t1.areas === 2 && t1.contact === 2 && t1.touched === true, `sum=${t1.sum} areas=${t1.areas} contact=${t1.contact}`);
  eq('§6 同一位置 contact 读邻黑格数', clueReading(two, 8, twoB, { readA: 'contact' }).sum, 2);
  eq('§6 这条盘按 area 读法是合法的（印的 5 对得上）', verify(two, twoB, { readA: 'area' }).length, 0);
  ok('§6 contribOf 三读法', contribOf({ size: 9 }, 'area') === 9 && contribOf({ size: 9 }, 'wrap') === 9 && contribOf({ size: 9 }, 'contact') === 1);
}

// ---------------------------------------------------------------- §7 铅笔自证
console.log('\n[§7 铅笔：满线索对照盘推得完；线索不足的盘必须留未知]');
{
  const base = baseFace(), truth = baseBlacks();
  // A. 基盘只有 3 条线索，解不唯一。一个 sound 的零猜测铅笔**必须**留下未知格 ——
  //    它若在这张盘上"推完了"，说明它在编答案而不是在读条款。
  const thin = pencilSolve(base);
  ok('§7 线索不足时不假装推完', thin.done === false && thin.unknown > 0, `unknown=${thin.unknown} done=${thin.done}`);
  eq('§7 未推完时不交 legality（legalIfDone 只在 done 时有值）', thin.legalIfDone, null);
  eq('§7 线索不足时也不出错（矛盾 0）', thin.conflicts.length, 0);
  eq('§7 但推出的每一条都对得上其中一个解（soundness）', auditLedger(thin.ledger, truth).oob, 0);
  eq('§7 P1clueWhite 恰打满基盘的 3 个线索格', thin.fires.P1clueWhite, 3);

  // B. 同一张几何，把**每个**白格的读数都印出来 = 满线索对照盘（31 条线索 / 36 格）。
  //    它是"线索够用时铅笔确实推得完、且推到的就是裁判交回的那唯一解"的证人。
  const full = printAllReadings(BASE_CELLS);
  const r = pencilSolve(full);
  ok('§7 满线索对照盘推得完', r.done === true && r.unknown === 0, `unknown=${r.unknown} 矛盾 ${r.conflicts.length}`);
  eq('§7 推完的整盘过规则模型（legalIfDone=0）', r.legalIfDone, 0);
  let diff = 0;
  for (let i = 0; i < 36; i++) if ((r.st[i] === BLK) !== (truth[i] === 1)) diff++;
  eq('§7 推完的黑格集合逐格等于那张真解', diff, 0);
  eq('§7 账本没有越轨（对着真值）', auditLedger(r.ledger, truth).oob, 0);
  eq('§7 整盘状态没有不符（对着真值）', auditState(r, truth).wrong, 0);
  eq('§7 满线索盘的 P1clueWhite 打满全部 31 条线索', r.fires.P1clueWhite, 31);
  ok('§7 每条 fired 规则都来自 RULES 表', Object.keys(r.fires).every((k) => RULES.includes(k)) && RULES.every((k) => k in r.fires), RULES.join(','));
  ok('§7 没走过分支（overrun=false 且 sweeps 有限）', r.overrun === false && r.sweeps < 500, `sweeps=${r.sweeps} steps=${r.steps}`);
  ok('§7 推完之后状态数组里没有一个 UNK', !r.st.includes(UNK), `未知格 ${r.unknown}`);
  eq('§7 推完的涂黑恰是那张的 2 个方形区', components(6, 6, r.blacks).length, 2);
  eq('§7 推完的涂黑满足 [R6]（白格连通）', whitesConnected(6, 6, r.blacks), true);
}

// ---------------------------------------------------------------- §8 负控
console.log('\n[§8 负控：证人必须能被伪造骗出反应]');
{
  const base = baseFace(), truth = baseBlacks();
  const r = pencilSolve(base);
  const freeCells = [];
  for (let i = 0; i < 36; i++) if (base.c[i] === FREE) freeCells.push(i);
  const fak = freeCells.slice(0, 25).map((i, t) => ({ i, v: truth[i] === 1 ? WHT : BLK, rule: RULES[t % RULES.length], FAKE: true }));
  eq('§8 真账本越轨 0', auditLedger(r.ledger, truth).oob, 0);
  const mixed = r.ledger.concat(fak);
  const caught = auditLedger(mixed, truth).oob;
  eq('§8 交错注入 25 条伪造结论 → 全部审出', caught, 25);
  const restored = r.ledger.filter((x) => !x.FAKE);
  eq('§8 伪造改回真值后越轨归零', auditLedger(restored, truth).oob, 0);
  // 第二条负控：把错色当**已知条件**喂进引擎本身（不是账本），必须留下痕迹
  const wrongPreset = pencilSolve(base, { preset: freeCells.slice(0, 25).map((i, t) => ({ i, v: truth[i] === 1 ? WHT : BLK, rule: RULES[t % RULES.length] })) });
  ok('§8 错色当前提喂进引擎：矛盾 > 0 且不算推完', wrongPreset.conflicts.length > 0 && wrongPreset.done === false, `矛盾 ${wrongPreset.conflicts.length} 条，done=${wrongPreset.done}`);
  ok('§8 错色前提也被告账本证人抓到', auditLedger(wrongPreset.ledger, truth).oob > 0, `越轨 ${auditLedger(wrongPreset.ledger, truth).oob} 条`);
}

// ---------------------------------------------------------------- §9 一份几何两个消费者
console.log('\n[§9 共享 squareTable 之后：裁判两版挑格与铅笔必须说同一件事]');
{
  const base = baseFace();
  const A = countSolutions(base, { limit: 3, wantSolutions: true, nodeCap: 200000 });
  const B = countSolutions(base, { limit: 3, wantSolutions: true, mrv: false, nodeCap: 200000 });
  eq('§9 MRV 序与行序数出同一个 count', A.count, B.count);
  ok('§9 两版都没撞预算（stopped 才是预算破口；count 撞上 limit 是正常读数）',
    A.stopped === false && B.stopped === false, `MRV nodes=${A.nodes} 行序 nodes=${B.nodes} stopped=${A.stopped}/${B.stopped}`);
  eq('§9 裁判的 wrapDup 恒 0（引理在搜索里的证人）', A.wrapDup + B.wrapDup, 0);
  eq('§9 裁判交回的解都被规则模型认可', auditSolutions(base, A, {}), 0);
  const p0 = pencilSolve(base);
  eq('§9 两个消费者的方形表同源（薄盘）', p0.squares, A.candidates);
  // 唯一解那张 = 满线索对照盘：裁判数到 1，铅笔零猜测推完，两边必须是**同一张**涂黑。
  // （薄基盘解不唯一，铅笔在上面本来就不该交回一张完整盘 —— 拿它比等于比空气。）
  const full = printAllReadings(BASE_CELLS);
  const F = countSolutions(full, { limit: 2, wantSolutions: true, nodeCap: 200000 });
  ok('§9 满线索对照盘是唯一解且没撞预算', F.count === 1 && F.stopped === false, `count=${F.count} nodes=${F.nodes} stopped=${F.stopped}`);
  const p = pencilSolve(full);
  let diff = 0;
  for (let i = 0; i < 36; i++) if ((p.st[i] === BLK) !== (F.solutions[0][i] === 1)) diff++;
  eq('§9 铅笔推完的那张 = 裁判交回的唯一解', diff, 0);
  eq('§9 两个消费者的方形表同源（对照盘）', p.squares, F.candidates);
  eq('§9 唯一解那张整盘过规则模型（不是数出来的自洽）', verify(full, F.solutions[0], {}).length, 0);
  // 自相矛盾的题面：印一个 4x4 上根本够不到的读数 —— 裁判数到 0，铅笔给矛盾，
  // 两边都不许假装"这盘推完了"。
  const contra = makeFace(['. 999 . .', '. . . .', '. . . .', '. . . .']);
  const C = countSolutions(contra, { limit: 2, nodeCap: 200000 });
  const Pc = pencilSolve(contra);
  eq('§9 不可能盘：裁判 count=0', C.count, 0);
  ok('§9 不可能盘：铅笔必须给矛盾而不是 done', Pc.done === false && (Pc.conflicts.length > 0 || Pc.unknown > 0), `done=${Pc.done} 矛盾 ${Pc.conflicts.length} 未知 ${Pc.unknown}`);
  // 只有 '?' 的盘：线索本身合法但题面几乎无约束，count 必须 > 1（不许被当成唯一解）
  const onlyQ = makeFace(['. . .', '. ? .', '. . .']);
  const Q = countSolutions(onlyQ, { limit: 2, nodeCap: 200000 });
  ok('§9 单问号盘不是唯一解', Q.count >= 2 || Q.limitReached, `count=${Q.count} limitReached=${Q.limitReached}`);
  // 预算闸必须真的会停：把 nodeCap 压到极小，同一张基盘要报 stopped 而不是"数完了"
  const tight = countSolutions(base, { limit: 2, nodeCap: 3 });
  ok('§9 nodeCap 压到 3 就 stopped 且归因=node', tight.stopped === true && tight.stoppedBy === 'node', `stopped=${tight.stopped} 归因=${tight.stoppedBy} nodes=${tight.nodes}`);
  ok('§9 stopped 的盘不是读数（exact=false）', tight.exact === false, `count=${tight.count} exact=${tight.exact}`);
}

console.log(`\nRULE-TEST ${checks} checks / ${fails} failed`);
process.exit(fails ? 1 : 0);
