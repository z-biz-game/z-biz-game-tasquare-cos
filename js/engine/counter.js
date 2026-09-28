// 穷举裁判 · countSolutions —— "这盘有几个解"的唯一权威回答
//
// 搜索形状（刻意与铅笔不同：铅笔是"条款只留一个选项才下结论"，裁判是把候选全走完）：
//
//  PHASE 1 只由**数字线索**驱动，按 MRV 序（mrv:true）或行序（mrv:false）逐条线索走。
//   一个圈内数字钉死了"正交碰到它的黑区"这个多重集合：它至多有 4 个碰触格（每边一个），
//   而且 —— 由 rules.js 的几何引理（线索格永不黑 + 区是实心方形）—— 没有一个区能碰它两条边。
//   所以每个邻区恰好占用该线索的**一个**邻格，[R4] 约束就是"每方向至多一区"上的子集和。
//   我们枚举这个子集和、放下选中的区，然后把这条线索剩下的开放邻格**封口**（force white）：
//   和已经精确，后面任何区都不许再碰它。这是完备的 —— 任何碰这条线索的区都会在这条线索
//   轮到它时还是候选，因为它的每一格在当前部分放置的任何延伸下都还是开放的。
//   '?' 线索**不参与 PHASE 1**（第二个碰触区并不违反"至少邻一个黑格"，让它做主人会重复计数）；
//   它们在变得不可满足时被剪掉，在叶子上被检查。
//  PHASE 2 用行主序"第一个开放格"分支走完剩余格子（保持白 / 以该格为左上角放一个各合法边长的
//   区）—— 这是任意涂黑的**唯一**分解，所以同一个解不会被数两次。
//   白格连通性在"涂黑"下单调，所以每个节点都用它做可靠的剪枝。
//
// 成本口径：判据 2（"计数器成本由线索封顶"）就是这份实现成立与否。本仓的量法与读数：
//  · 单次搜索节点：证书（裁完线索的出货判定）两批 n=60 实测 max 1,338（irr-8x8，另一批 966），
//    6×6 档 ≤210 —— 与出货预算 nodeCap=200,000 之间还有 149× 余量（这条余量由 balance §B 逐档守）。
//  · 一张出货盘要跑多少次计数：由 receipt 当场记账（certTried + 每次成功认证的出货判定 + 裁线索
//    探针）。裁线索探针逐档实测 0–6（easy-6x6）/ 15–25（irr-6x6）/ 12–40（mid-8x8）/ 28–42
//    （irr-8x8），极小化就是"逐条试删、删掉后仍证明唯一才删"，所以探针数 ≈ 印刷前的线索数。
//  · stopped 的观测：两批 n=60 出货路径上 0 次 ship-stopped、0 次探针击穿。
// MRV 与行序**两版都留着**，并且要逐张对撞（tools/counter-test.mjs §3：18 张出货盘上两种顺序
// 数出的 count 逐张相同，节点 med 67 vs 62、max 635 vs 508 —— **没有方向可言**，所以那一节
// 断言的是"两版的尾巴都离预算足够远"，不是"MRV 更快"）：只留一版的话，"穷举很便宜"就可能
// 是我自己挑格顺序的运气（这条在别的题材上让我差点用一个自造的假阴性否掉整个品类）。
//
// stopped 是诚实的：撞预算/撞钟就不是一个读数，`exact` 只在没停且没到 limit 时为真。
// 两个闸都在**每次进节点**时查，ms 闸每 256 个节点查一次（performance.now() 比节点计数贵得多）；
// ms 闸只是"死循环保险丝"——出货判定不许由它做出，这条由取样闸守住，见 generate.js 的 receipt。
// 这里**不**写 `import { performance } from 'node:perf_hooks'`：`node:` 前缀的说明符在浏览器里
// 解不开，整个模块图会在第一条语句上死掉。`performance` 在 node ≥16 与浏览器都是全局。

import { FREE, QMARK, opts, squareTable, contribOf, verify } from './rules.js';

const DIRS = [[-1, 0], [1, 0], [0, -1], [0, 1]];

/**
 * @param f    face（见 rules.js 的数据形状）
 * @param opt  {limit=2, nodeCap, msCap, mrv=true, readA, allowSingle, printZero, wantSolutions=false}
 */
export function countSolutions(f, opt = {}) {
  const o = opts(opt);
  const limit = opt.limit ?? 2;
  const nodeCap = opt.nodeCap ?? 200000;
  const msCap = opt.msCap ?? Infinity;
  const mrv = opt.mrv ?? true;
  const wantSolutions = opt.wantSolutions ?? false;
  const t0 = performance.now();
  const h = f.h, w = f.w, n = h * w, c = f.c;
  const isClue = (i) => c[i] !== FREE;
  const nbOf = (i, d) => {
    const r = (i / w) | 0, j = i % w, nr = r + DIRS[d][0], nc = j + DIRS[d][1];
    if (nr < 0 || nc < 0 || nr >= h || nc >= w) return -1;
    return nr * w + nc;
  };

  // ---- 几何：全仓唯一的一份候选方形表
  const T = squareTable(f, o);
  const sq = T.squares, cellSq = T.ofCell, topSq = T.ofTopLeft;

  // ---- 线索
  const numClues = [], qClues = [];
  for (let i = 0; i < n; i++) {
    if (c[i] === FREE) continue;
    if (c[i] === QMARK) qClues.push(i); else numClues.push({ i, v: c[i] });
  }
  const candOf = (p) => {
    let t = 0;
    for (let d = 0; d < 4; d++) { const q = nbOf(p, d); if (q >= 0 && !isClue(q)) t += cellSq[q].length; }
    return t;
  };
  const order = numClues.slice();
  // 比较器是纯函数（候选数 + 格号），随机数一律不许进来：node 与 Chrome 的 sort 对相等元素
  // 次序不同，那会让两边数出不同的"唯一解"。末级 tie-break 用格号 ⇒ 全序。
  if (mrv) order.sort((a, b) => candOf(a.i) - candOf(b.i) || a.i - b.i);
  else order.sort((a, b) => a.i - b.i);

  const contrib = (id) => contribOf(sq[id], o.readA);

  // ---- 状态
  const mark = new Int8Array(n);      // 0 open, 1 black, 2 sealed/banned, 3 white-decided
  const ban = new Int16Array(n);
  const owner = new Int32Array(n).fill(-1);
  for (let i = 0; i < n; i++) if (isClue(i)) mark[i] = 3;

  let nodes = 0, leaves = 0, assignments = 0, wrapDup = 0, conflict = 0;
  let count = 0, stopped = false, stoppedBy = null;
  const solutions = [];

  const placeable = (id) => { for (const i of sq[id].cells) if (mark[i] !== 0) return false; return true; };
  function apply(id, sign) {
    const S = sq[id];
    if (sign > 0) {
      for (const i of S.cells) { mark[i] = 1; owner[i] = id; }
      for (const i of S.nb) if (!isClue(i)) { if (ban[i]++ === 0 && mark[i] === 0) mark[i] = 2; }
    } else {
      for (const i of S.cells) { mark[i] = 0; owner[i] = -1; }
      for (const i of S.nb) if (!isClue(i)) { if (--ban[i] === 0 && mark[i] === 2) mark[i] = 0; }
    }
  }
  function whitesConnected() {
    let start = -1, whites = 0;
    for (let i = 0; i < n; i++) if (mark[i] !== 1) { whites++; if (start < 0) start = i; }
    if (whites === 0) return false;
    const seen = new Uint8Array(n);
    const st = [start]; seen[start] = 1; let cnt = 1;
    while (st.length) { const i = st.pop(); for (let d = 0; d < 4; d++) { const q = nbOf(i, d); if (q >= 0 && mark[q] !== 1 && !seen[q]) { seen[q] = 1; cnt++; st.push(q); } } }
    return cnt === whites;
  }
  function qOk() {
    for (const p of qClues) {
      let any = false;
      for (let d = 0; d < 4; d++) { const q = nbOf(p, d); if (q >= 0 && mark[q] === 1) { any = true; break; } }
      if (!any) return false;
    }
    return true;
  }
  function qStillPossible() {
    for (const p of qClues) {
      let any = false;
      for (let d = 0; d < 4; d++) { const q = nbOf(p, d); if (q >= 0 && (mark[q] === 1 || mark[q] === 0)) { any = true; break; } }
      if (!any) return false;
    }
    return true;
  }
  const bump = () => {
    nodes++;
    if (nodes > nodeCap) { stopped = true; stoppedBy = 'node'; return true; }
    if ((nodes & 255) === 0 && performance.now() - t0 > msCap) { stopped = true; stoppedBy = 'ms'; return true; }
    return false;
  };

  function finishLeaf() {
    leaves++;
    if (!whitesConnected() || !qOk()) return;
    count++;
    if (wantSolutions && solutions.length < 4) {
      const b = new Uint8Array(n);
      for (let i = 0; i < n; i++) if (mark[i] === 1) b[i] = 1;
      solutions.push(b);
    }
  }

  // ---- PHASE 2
  function residual() {
    if (stopped || count >= limit) return;
    if (bump()) return;
    if (!whitesConnected()) return;              // 单调：可靠的剪枝
    if (!qStillPossible()) return;
    let x = -1;
    for (let i = 0; i < n; i++) if (mark[i] === 0) { x = i; break; }
    if (x < 0) { finishLeaf(); return; }
    mark[x] = 3; residual(); mark[x] = 0;        // x 保持白
    for (const id of topSq[x]) {                 // x 是某个区的左上角
      if (!placeable(id)) continue;
      apply(id, +1);
      residual();
      apply(id, -1);
      if (stopped) return;
    }
  }

  // ---- PHASE 1
  function nextClue(k) {
    if (stopped || count >= limit) return;
    if (k === order.length) { residual(); return; }
    if (bump()) return;
    const p = order[k].i, v = order[k].v;
    let forced = 0;
    const dirs = [];
    const countedAreas = new Map();
    for (let d = 0; d < 4; d++) {
      const q = nbOf(p, d);
      if (q < 0 || isClue(q)) continue;
      if (mark[q] === 1) {
        const id = owner[q];
        const prev = countedAreas.get(id) || 0;
        countedAreas.set(id, prev + 1);
        if (prev > 0) wrapDup++;                 // 读法歧义 A：同一个区被碰两条边
        forced += contrib(id);
      } else if (mark[q] === 0) {
        const cands = [];
        for (const id of cellSq[q]) if (placeable(id)) cands.push(id);
        if (cands.length) dirs.push({ q, cands, max: cands.reduce((m, id) => Math.max(m, contrib(id)), 0) });
      }
    }
    // 去重：'area' 读法下重复的区只能算一次（wrap 读法按碰触边数累加）
    if (o.readA !== 'wrap') { forced = 0; for (const [id] of countedAreas) forced += contrib(id); }
    if (forced > v) { conflict++; return; }
    const suff = new Array(dirs.length + 1).fill(0);
    for (let i = dirs.length - 1; i >= 0; i--) suff[i] = suff[i + 1] + dirs[i].max;
    const seal = [];
    function enumDir(di, sum) {
      if (stopped || count >= limit) return;
      if (sum > v || sum + suff[di] < v) return;
      if (bump()) return;
      if (di === dirs.length) {
        if (sum !== v) return;
        assignments++;
        // 这条线索的和已经精确：封掉它其余的开放邻格，后面任何区都不许再碰它
        for (let d = 0; d < 4; d++) { const q = nbOf(p, d); if (q >= 0 && !isClue(q) && mark[q] === 0) { if (ban[q]++ === 0) mark[q] = 2; seal.push(q); } }
        nextClue(k + 1);
        for (const q of seal) { if (--ban[q] === 0 && mark[q] === 2) mark[q] = 0; }
        seal.length = 0;
        return;
      }
      const D = dirs[di];
      enumDir(di + 1, sum);                      // 这条边不出一区
      for (const id of D.cands) {
        if (!placeable(id)) continue;
        // 立刻 apply：同一条线索**其它边**上选中的区要能对着它查重叠/正交相邻
        apply(id, +1);
        enumDir(di + 1, sum + contrib(id));
        apply(id, -1);
        if (stopped) return;
      }
    }
    enumDir(0, forced);
  }

  nextClue(0);
  const ms = performance.now() - t0;
  return {
    count, nodes, leaves, assignments, candidates: sq.length, stopped, stoppedBy,
    limitReached: count >= limit, exact: !stopped && count < limit,
    wrapDup, ms, solutions,
  };
}

/** 见证：裁判自己交回的解，必须被规则模型认可为解（两套实现互为对账） */
export function auditSolutions(f, res, opt) {
  let bad = 0;
  for (const b of res.solutions) if (verify(f, b, opt).length) bad++;
  return bad;
}
