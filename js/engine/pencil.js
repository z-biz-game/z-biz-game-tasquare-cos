// 铅笔 · 零猜测求解器 —— "这盘不猜能不能推完"的唯一权威回答
//
// 它和裁判的关系是**强度差**，不是"快慢差"：裁判走完候选树回答"有几个解"，铅笔只在
// 引文那一条条款本身留下唯一选项时才下结论 —— 一个分支都不走，一次"如果…那么…"都不假设。
// 本仓的出货条件是两个断言同时成立（计数器认证唯一 ∧ 铅笔零猜测推完），所以这两份实现必须
// 对同一批候选方形说话：几何只从 rules.js 的 squareTable() 读，第二份枚举就是未来的分歧源。
//
// 规则表（名字 → 条款 → 结论）。名字里的 P4* 都归 [R4]/[R2]，因为它们靠的是"某格在不在
// 存活方形里"，这条在 2026-09-29 的筛选日志里贡献了绝大部分推理步：
//   P1clueWhite  [R1]  线索格 → 白
//   P2footprint  [R2]  已知黑块的**所有**存活宿主方形的公共格 → 黑（"这区只能长这么大"）
//   P3noTouch    [R3]  宿主方形唯一的那个黑块的邻格 → 白（再黑就与它共边）
//   P4noSquare   [R2]+[R1] 不被任何存活方形包含的空格 → 白
//   P4zero       [R4]  数字线索的某条边在**每一种可行读法**里都贡献 0 → 白（含"需要 0 的线索"）
//   P4need       [R4]  某条边在每一种读法里都必须贡献 (>0) → 黑
//   P5qonlyOne   [R5]  '?' 的可黑邻格只剩一个 → 黑
//   P6conn       [R6]  同 P4noSquare，但该格的所有宿主方形都是被白格连通性杀掉的 → 白
//
// [R4] 的子集和之所以是**精确**约束（不是松弛），靠的是几何引理：一个区碰一个线索至多一条边，
// 所以"每边至多一个区"和"每个邻格至多属于一个区"等价。引理见 rules.js 文件头。
//
// 方形淘汰的四个原因**分开记账**（cause/killed 里 R1W、R3、R6、R4），因为"被哪条条款杀掉"
// 是排除力的证人，不是结论；P6conn 与 P4noSquare 的分界就是靠这份归因。
//
// 已知不完备（诚实披露，不许在页面或 README 里说成"本品类都能纯逻辑解"）：筛选屏实测
// 出货形状的盘 47/63 = 74.6% 能零猜测推完，其余 25.4% 卡在"多候选杀不完"。这些盘**不出货**，
// 由出题器换种子重铺 —— 推不完是生成器的拒绝理由，不是玩家的难度。
// P6conn 在 63 张出货形状盘上一次没命中（连通性只在生成期当过滤器，淘汰 37 次），所以它
// **不是**难度梯级，不许写成"高级技巧"。
//
// 完备性证人不是 self-declared：done 之后还要 `legalIfDone === 0`（拿规则模型复核整盘），
// 并由 auditLedger/auditState 逐条比对唯一解那张真值 —— 两条 witness 见文件末尾。

import { FREE, QMARK, UNK, BLK, WHT, opts, squareTable, contribOf, verify, neighbours } from './rules.js';

export { UNK, BLK, WHT };

export const RULES = ['P1clueWhite', 'P2footprint', 'P3noTouch', 'P4noSquare', 'P4zero', 'P4need', 'P5qonlyOne', 'P6conn'];

/** 每条规则引用的条款原文（页面上的"为什么"直接读这里，别在 UI 里另写一份） */
export const CLAUSES = {
  P1clueWhite: '[R1] 数字与问号的格子都不能涂黑',
  P2footprint: '[R2] 每一个黑格组必须是实心正方形：所有可能形状公共的那些格必然黑',
  P3noTouch: '[R3] 黑方块之间不得共边：这一格的区已定死，它的邻格就都不能黑',
  P4noSquare: '[R2]+[R1] 没有任何合法的正方形区还容得下这一格',
  P4zero: '[R4] 圈内数字＝邻接黑区格数之和：这条边在每种读法里都只能贡献 0',
  P4need: '[R4] 圈内数字＝邻接黑区格数之和：这条边在每种读法里都必须贡献',
  P5qonlyOne: '[R5] 问号至少邻一个黑格：可黑的邻格只剩一个',
  P6conn: '[R6] 白格必须整体连通：若把这一格涂黑，白格子就被切开了',
};

/**
 * @param f    face
 * @param opt  {readA, allowSingle, printZero, preset=null, maxSweeps=500}
 * @returns {done, unknown, steps, sweeps, overrun, deductions, cells, fires, firedOn,
 *            killed, conflicts, st, ledger, blacks, squares, aliveLeft, legalIfDone}
 */
export function pencilSolve(f, opt = {}) {
  const o = opts(opt);
  const maxSweeps = opt.maxSweeps ?? 500;
  const { h, w, c } = f, n = h * w;
  const isClue = (i) => c[i] !== FREE;
  const NB = (i) => neighbours(i, h, w);

  // 几何：全仓唯一的一份候选方形表（与裁判同一份）
  const T = squareTable(f, o);
  const S = T.squares, sqOf = T.ofCell;
  const contrib = (sq) => contribOf(sq, o.readA);
  const numClues = [], qClues = [];
  for (let i = 0; i < n; i++) { if (c[i] === QMARK) qClues.push(i); else if (c[i] !== FREE) numClues.push({ i, v: c[i] }); }

  // ---- 状态
  const st = new Int8Array(n);
  const alive = new Uint8Array(S.length).fill(1);
  const cause = new Array(S.length).fill(null);
  const ledger = [];
  const fires = Object.fromEntries(RULES.map((r) => [r, 0]));
  const firedOn = Object.fromEntries(RULES.map((r) => [r, false]));
  const killed = { R1W: 0, R3: 0, R6: 0, R4: 0 };
  const conflicts = [];
  let newCell = 0;

  const claim = (i, v, rule) => {
    if (st[i] === v) return;
    if (st[i] !== UNK) { conflicts.push(`矛盾 ${rule}: cell ${i} asked ${v === BLK ? 'B' : 'W'} but is ${st[i] === BLK ? 'B' : 'W'}`); return; }
    st[i] = v; ledger.push({ i, v, rule });
    fires[rule]++; firedOn[rule] = true; newCell++;
  };

  // preset 只给负控用（把假结论当真结论塞进账本，看证人抓不抓得住）；判定路径不许用。
  if (o.preset) for (const p of o.preset) { if (st[p.i] === UNK) { st[p.i] = p.v; ledger.push({ i: p.i, v: p.v, rule: p.rule || 'PRESET-FABRICATED' }); } }
  // [R1] 每个线索格都是白 —— 直接读条款，不搜索。
  for (let i = 0; i < n; i++) if (isClue(i)) claim(i, WHT, 'P1clueWhite');

  const hasAlive = (i) => sqOf[i].some((id) => alive[id]);
  const aliveHosting = (i) => sqOf[i].filter((id) => alive[id]);
  /** 方形还放得下吗？三个原因，都是条款读法（归因分开记账） */
  function killByState() {
    let died = 0;
    for (const sq of S) {
      if (!alive[sq.id]) continue;
      let why = null;
      for (const i of sq.cells) if (st[i] === WHT || isClue(i)) { why = 'R1W'; break; }   // [R1][R2]
      if (!why) for (const q of sq.nbFree) if (st[q] === BLK) { why = 'R3'; break; }      // [R3]
      if (!why && whitesSplit(sq)) why = 'R6';                                            // [R6]
      if (why) { alive[sq.id] = 0; cause[sq.id] = why; killed[why]++; died++; }
    }
    return died;
  }
  /** 若把方形 sq 涂黑，已定白的格子还会连成一块吗？[R6] */
  function whitesSplit(sq) {
    const forb = new Uint8Array(n);
    for (const i of sq.cells) forb[i] = 1;
    let seed = -1, want = 0;
    for (let i = 0; i < n; i++) if (st[i] === WHT) { want++; if (seed < 0) seed = i; }
    if (want === 0 || forb[seed]) return false;
    const seen = new Uint8Array(n), stk = [seed]; seen[seed] = 1; let got = 0;
    while (stk.length) { const i = stk.pop(); if (st[i] === WHT) got++; for (const q of NB(i)) if (!seen[q] && !forb[q] && st[q] !== BLK) { seen[q] = 1; stk.push(q); } }
    return got !== want;
  }
  /** 已定黑格的边连通块：每一块都在同一个区里 [R2][R3] */
  function blocks() {
    const seen = new Uint8Array(n), out = [];
    for (let i = 0; i < n; i++) {
      if (st[i] !== BLK || seen[i]) continue;
      const comp = [], stk = [i]; seen[i] = 1;
      while (stk.length) { const x = stk.pop(); comp.push(x); for (const q of NB(x)) if (!seen[q] && st[q] === BLK) { seen[q] = 1; stk.push(q); } }
      out.push(comp);
    }
    return out;
  }

  /** [R4]：对"每边至多一区"做子集和（由几何引理这是精确读法）。既下结论也收窄候选。 */
  function clueReadings() {
    let narrowed = 0;
    for (const { i: p, v } of numClues) {
      const edges = [];
      for (const q of NB(p)) {
        if (isClue(q)) continue;
        const sizes = new Set(aliveHosting(q).map((id) => contrib(S[id])));
        if (st[q] === BLK && sizes.size === 0) { conflicts.push(`矛盾 R4: clue ${p} 的已黑邻格 ${q} 没有任何存活方形`); continue; }
        const choices = st[q] === WHT ? [0] : st[q] === BLK ? [...sizes] : sizes.size ? [...sizes, 0] : [0];
        edges.push({ q, choices });
      }
      const feas = [];
      const acc = new Array(edges.length).fill(0);
      (function walk(k, sum) {
        if (sum > v) return;
        if (k === edges.length) { if (sum === v) feas.push(acc.slice()); return; }
        for (const t of edges[k].choices) { acc[k] = t; walk(k + 1, sum + t); }
      })(0, 0);
      if (!feas.length) { conflicts.push(`矛盾 R4: clue ${p} 标注 ${v} 无可行读法`); continue; }
      edges.forEach((e, k) => {
        const seen = new Set(feas.map((t) => t[k]));
        if (seen.size === 1 && seen.has(0)) claim(e.q, WHT, 'P4zero');            // [R4] 需要 0 的线索
        else if (!seen.has(0)) claim(e.q, BLK, 'P4need');                          // [R4] 必须贡献
        for (const id of aliveHosting(e.q)) {
          const s2 = contrib(S[id]);
          if (!seen.has(s2)) { alive[id] = 0; cause[id] = 'R4'; killed.R4++; narrowed++; }
        }
      });
    }
    return narrowed;
  }

  function conclude() {
    // [R5] '?' 的可黑邻格只剩一个
    for (const p of qClues) {
      let sat = false; const cand = [];
      for (const q of NB(p)) {
        if (isClue(q)) continue;                     // [R1] 线索格不能当那个黑格
        if (st[q] === BLK) { sat = true; break; }
        if (st[q] === UNK && hasAlive(q)) cand.push(q);
      }
      if (sat) continue;
      if (!cand.length) { conflicts.push(`矛盾 R5: ? ${p} 已无任何可黑邻格`); continue; }
      if (cand.length === 1) claim(cand[0], BLK, 'P5qonlyOne');
    }
    // [R2][R3] 逐块：公共足迹 + 唯一宿主的邻格
    for (const B of blocks()) {
      const set = new Set(B);
      const hosting = S.filter((sq) => alive[sq.id] && B.every((i) => sq.cells.includes(i)));
      if (!hosting.length) { conflicts.push(`矛盾 R2: 黑块 ${B.join(',')} 没有任何存活方形`); continue; }
      const inter = hosting[0].cells.filter((i) => hosting.every((sq) => sq.cells.includes(i)));
      for (const i of inter) if (!set.has(i)) claim(i, BLK, 'P2footprint');
      // 两个不同的方形永不共享同一格集，所以"所有候选都一样"就等于"只有一个候选"
      if (hosting.length === 1) for (const q of hosting[0].nbFree) if (st[q] === UNK) claim(q, WHT, 'P3noTouch');
    }
    // [R2]+[R1] 没有任何存活方形包含的格，按死因归到 P6conn / P4noSquare
    for (let i = 0; i < n; i++) {
      if (st[i] !== UNK || isClue(i)) continue;
      const list = sqOf[i];
      if (list.length && !list.some((id) => alive[id])) {
        const cs = new Set(list.map((id) => cause[id]));
        claim(i, WHT, cs.size === 1 && cs.has('R6') ? 'P6conn' : 'P4noSquare');
      }
    }
  }

  let sweeps = 0, steps = 0, overrun = false;
  for (; sweeps < maxSweeps; sweeps++) {
    const before = newCell;
    const beforeKill = killed.R1W + killed.R3 + killed.R6 + killed.R4;
    killByState();
    clueReadings();
    conclude();
    if (newCell > before) steps++;
    if (newCell === before && (killed.R1W + killed.R3 + killed.R6 + killed.R4) === beforeKill) break;
  }
  if (sweeps >= maxSweeps) overrun = true;
  let unknown = 0;
  for (let i = 0; i < n; i++) if (!isClue(i) && st[i] === UNK) unknown++;
  const blacks = new Uint8Array(n);
  for (let i = 0; i < n; i++) if (st[i] === BLK) blacks[i] = 1;
  return {
    done: unknown === 0 && conflicts.length === 0, unknown, steps, sweeps, overrun,
    deductions: ledger.length, cells: n - numClues.length - qClues.length,
    fires, firedOn, killed, conflicts, st, ledger, blacks,
    squares: S.length, aliveLeft: alive.reduce((a, x) => a + x, 0),
    legalIfDone: unknown === 0 ? verify(f, blacks, o).length : null,
  };
}

/** 健全性证人 1：账本里每一条结论都对着**唯一解那张真值**比一遍 */
export function auditLedger(ledger, truth) {
  let oob = 0; const bad = [];
  for (const rec of ledger) {
    const isB = truth[rec.i] === 1;
    if ((rec.v === BLK) !== isB) { oob++; if (bad.length < 6) bad.push(`${rec.i}[${rec.rule}] 断${rec.v === BLK ? '黑' : '白'} 真${isB ? '黑' : '白'}`); }
  }
  return { oob, bad };
}
/** 健全性证人 2：推完的整盘状态 vs 真值 */
export function auditState(res, truth) {
  let wrong = 0, missing = 0;
  for (let i = 0; i < res.st.length; i++) {
    if (res.st[i] === UNK) { missing++; continue; }
    if ((res.st[i] === BLK) !== (truth[i] === 1)) wrong++;
  }
  return { wrong, missing };
}
