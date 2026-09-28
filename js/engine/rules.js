// 规则模型 · Tasukuea / Tasquare（たすくえあ，日文直译"找正方形"）
//
// 题面（唯一可达的规则出处：Cross+A 英文索引 https://www.cross-plus-a.com/puzzles.htm 的
// Tasukuea 条目，检索日期 2026-09-29，逐字引文：
//   "Tasukuea ("Tasquare"; from Japanese, literally "find squares") is a type of logic puzzles.
//   It is played on a rectangular or square grid with numbers or question signs in some cells.
//   The goal is to blacken some cells of a grid according to the following rules:
//   - Cells with numbers or question signs can not be blacken.
//   - Black cells form square areas, that must not be orthogonally adjacent.
//   - A number in a circle indicates the total number of black cells in areas orthogonally
//     neighbouring the numbered cell.
//   - A cell with a question sign must have at least one adjacent black cell.
//   - All the white cells must be connected horizontally or vertically."）
//
// 源文本**定死**的：线索格（数字与 '?' 都算）永不能涂黑（R1）。
// 源文本**没定**的三处，这里做成开关，每一处在本仓都有一条闸正反各量一遍：
//   A readA:  'area'    = 邻接黑区**面积**之和（每区算一次）  <- 上面那句的逐字读法，本仓默认
//             'wrap'    = 同上，但一区若在两条边上碰到该线索就加两次
//             'contact' = 正交邻接的**黑格个数**
//     ⇒ 'area' 与 'wrap' 在数学上是**同一个函数**，见下面的几何引理（证人：counter-test §7 让
//       两种读法在整份语料上数出同一批解，且 wrapDup 恒 0）；'contact' 是另一种读法，读数不同
//       （证人：counter-test §5 在同一批题面上打出 area=1,1,1,… 对 contact=0,0,0,…，
//        balance §G 再用同种子只换读法的配对证明它会换掉出货的盘），所以默认值必须由源文本
//       决定而不是由方便决定 —— 本仓按逐字读法 'area' 出货。
//   B allowSingle: 1x1 的黑格算不算一个"正方形区"？源文本没说，本仓按"算"（默认 true）。
//     证人：rule-test §4 的 N7（B=off 时 1x1 判 R2b）与 P7（默认合法）两张题面。
//   C printZero:   格子里能不能印一个 0（＝该线索不邻接任何黑区）？源文本没说，本仓按"能"。
//     ⇒ 这一条是**承重的**：balance §G 在 12 颗固定种子 `knob|<s>` 上量到，禁印 0 之后同一批
//       grown 面的"唯一解率"从 5/5 掉到 2/5（那条闸就是 `off.u < on.u`，与 SAMPLES 无关，任何一次
//       `node tools/balance.mjs` 都重现），而 0 恰恰是铅笔最常用的条款。所以它是**本仓口径**，
//       不是出版惯例，页面上要让人看见"0 是一个合法数字"这件事。
//
// 几何引理（穷举验证过，不是假设）：因为线索格永不涂黑（R1）且黑区是实心正放方形（R2），
// 任何一个黑区都**不可能**沿两条边同时碰到同一个线索格 —— 任何包含某格 p 的两个不同正交邻格
// 的轴对齐实心方形必然也包含 p。穷举 6x6/6x7/7x6/7x7 上全部（方形区, 外部格）配对 3,052 例，
// "碰多于一条边"= 0 例。⇒ 读法 A 的两个分支恒等；而"每方向至多一区"这件事让整个 [R4] 子集和
// 是**精确**约束而不是松弛，铅笔与裁判都靠它。
//
// 数据形状（全仓统一，别处不许自创表示）：
//   face = { h, w, c: Int32Array(h*w) }，行主序，格号 i = r*w + j。
//          c[i] = FREE(-1) 空格（可黑可不黑）｜QMARK(-2) 问号线索｜0..N 数字线索。
//          数字**不限一位**（文本形式用空格分 token，见 makeFace/faceTokens）。
//   blacks = Uint8Array(h*w)，1 = 涂黑。这是"一个完整解"的唯一表示。
//   area   = { r, j, s }：左上角 (r,j)、边长 s 的实心正方形区。出题器产出的是 area 列表，
//            裁判吃的是 blacks —— 两者之间由 verifyAreas/areasToBlacks 换算，不许别处自拼。
//   违反记录 = { code: 'R1'|'R2'|'R2b'|'R3'|'R4'|'R5'|'R6', msg }，一条条款一个 code，
//            msg 里带坐标；同一格既违 R1 又违 R4 只报 R1（否则一个坏格级联出一堆假 R4）。
//
// 本文件是"什么算一张合法盘"的**唯一定义**：裁判、铅笔、出题器与全部见证都从这里读几何。
// 尤其 `squareTable()` —— 候选方形的枚举只此一份。裁判和铅笔曾经各写一遍，两遍的意思若有一
// 天分岔，"唯一解"和"零猜测可推完"就不再是对同一批盘形的两个断言，而本仓的出货条件恰好要
// 这两个断言同时成立。

export const FREE = -1;
export const QMARK = -2;
export const UNK = 0, BLK = 1, WHT = 2;

export const DEFAULTS = Object.freeze({ readA: 'area', allowSingle: true, printZero: true });
export const opts = (o) => ({ ...DEFAULTS, ...o });

/**
 * 文本形式 → face。每行是一个字符串或 token 数组；token = '.' | '?' | 非负整数（多位可，
 * 字符串行需以空格分隔才能写两位数）。
 */
export function makeFace(rows) {
  const norm = rows.map((r) => (typeof r === 'string' ? r.trim().split(/\s+/) : r.slice()));
  const w = norm[0].length;
  const h = norm.length;
  for (const r of norm) if (r.length !== w) throw new Error('ragged rows');
  const c = new Int32Array(h * w);
  for (let r = 0; r < h; r++) for (let j = 0; j < w; j++) {
    const t = String(norm[r][j]);
    // 校验吃的是 **token 本身**而不是存进去的值：QMARK(-2) 天生比 FREE(-1) 小，
    // 拿"存进去之后再查下界"的写法会把自己唯一的两个哨兵之一当成非法输入。
    if (t === '.') c[r * w + j] = FREE;
    else if (t === '?') c[r * w + j] = QMARK;
    else if (!/^\d+$/.test(t)) throw new Error(`非法 token "${t}" @${r},${j}（空格用 '.'、问号用 '?'、数字用非负十进制）`);
    else c[r * w + j] = Number(t);
  }
  return { h, w, c };
}
export const cloneFace = (f) => ({ h: f.h, w: f.w, c: Int32Array.from(f.c) });

/** face → token 行（二维数组，多位数字自洽；'.'=空，'?'=问号线索） */
export function faceTokens(f) {
  const out = [];
  for (let r = 0; r < f.h; r++) {
    const row = [];
    for (let j = 0; j < f.w; j++) { const v = f.c[r * f.w + j]; row.push(v === FREE ? '.' : v === QMARK ? '?' : String(v)); }
    out.push(row);
  }
  return out;
}
export const faceRows = (f) => faceTokens(f).map((r) => r.join(' '));

/** 人读的一行串：#=黑，其余照印（blacks 省略 = 只印题面） */
export function showFace(f, blacks) {
  const out = [];
  for (let r = 0; r < f.h; r++) {
    let s = '';
    for (let j = 0; j < f.w; j++) {
      const i = r * f.w + j, v = f.c[i];
      s += (blacks && blacks[i]) ? '#' : v === FREE ? '.' : v === QMARK ? '?' : String(v);
    }
    out.push(s);
  }
  return out.join('/');
}

/** [[r,j],...] → blacks */
export function blacksOf(cells, h, w) {
  const b = new Uint8Array(h * w);
  for (const [r, j] of cells) b[r * w + j] = 1;
  return b;
}

export function neighbours(i, h, w) {
  const r = (i / w) | 0, j = i % w, out = [];
  if (r > 0) out.push(i - w);
  if (r < h - 1) out.push(i + w);
  if (j > 0) out.push(i - 1);
  if (j < w - 1) out.push(i + 1);
  return out;
}

/** 黑格集的正交极大分量（含包围盒，供"是不是实心方形"判定） */
export function components(h, w, blacks) {
  const n = h * w, seen = new Int32Array(n).fill(-1);
  const comps = [];
  for (let s = 0; s < n; s++) {
    if (!blacks[s] || seen[s] >= 0) continue;
    const id = comps.length, stack = [s], cells = [];
    seen[s] = id;
    while (stack.length) {
      const i = stack.pop();
      cells.push(i);
      for (const q of neighbours(i, h, w)) if (blacks[q] && seen[q] < 0) { seen[q] = id; stack.push(q); }
    }
    cells.sort((a, b) => a - b);
    let rmin = 1e9, rmax = -1e9, jmin = 1e9, jmax = -1e9;
    for (const i of cells) { const r = (i / w) | 0, j = i % w; if (r < rmin) rmin = r; if (r > rmax) rmax = r; if (j < jmin) jmin = j; if (j > jmax) jmax = j; }
    comps.push({ id, cells, size: cells.length, side: rmax - rmin + 1, span: jmax - jmin + 1, rmin, rmax, jmin, jmax });
  }
  return comps;
}

/**
 * 全仓唯一的候选方形枚举（见文件头"唯一定义"）。
 * 返回 { squares, ofCell, ofTopLeft }：
 *   squares[k] = { id, cells, side, size, nb, nbFree, nbClue }
 *     nb      = 所有外部正交邻格（去重）
 *     nbFree  = 其中不是线索的那些（铅笔的 adj / 裁判的"可封格"都从这读）
 *     nbClue  = 其中是线索的那些，[{ p, cell }] 按 p 去重；由几何引理，一个区碰一个线索至多
 *               一条边，所以 (p, cell) 是唯一确定的 —— 这不是省字段，这是引理的推论。
 *   ofCell[i] / ofTopLeft[i] = 含格 i 的区号 / 以 i 为左上角的区号（裁判的两个索引表）。
 * 包含任何线索格的方形**不生成**（R1 直接把候选空间切掉，这是判据 2 便宜的全部原因）。
 */
export function squareTable(f, o = {}) {
  o = opts(o);
  const { h, w } = f, n = h * w, c = f.c;
  const isClue = (i) => c[i] !== FREE;
  const squares = [];
  const ofCell = Array.from({ length: n }, () => []);
  const ofTopLeft = Array.from({ length: n }, () => []);
  for (let s = o.allowSingle ? 1 : 2; s <= Math.min(h, w); s++) {
    for (let r = 0; r + s <= h; r++) for (let j = 0; j + s <= w; j++) {
      const cells = [];
      let bad = false;
      for (let a = r; a < r + s && !bad; a++) for (let bq = j; bq < j + s; bq++) {
        const i = a * w + bq;
        if (isClue(i)) { bad = true; break; }
        cells.push(i);
      }
      if (bad) continue;
      const inside = new Set(cells), nb = [], nbFree = [], nbClue = [];
      for (const i of cells) for (const q of neighbours(i, h, w)) {
        if (inside.has(q)) continue;
        if (!nb.includes(q)) nb.push(q);
        if (isClue(q)) { if (!nbClue.some((t) => t.p === q)) nbClue.push({ p: q, cell: i }); }
        else if (!nbFree.includes(q)) nbFree.push(q);
      }
      const id = squares.length;
      squares.push({ id, cells, side: s, size: s * s, nb, nbFree, nbClue });
      for (const i of cells) ofCell[i].push(id);
      ofTopLeft[r * w + j].push(id);
    }
  }
  return { squares, ofCell, ofTopLeft };
}

/** 一个区给它所碰的线索贡献多少（读法 A 的三个分支；'contact' 与面积无关） */
export const contribOf = (sq, readA) => (readA === 'contact' ? 1 : sq.size);

/** 线索格 i 在给定涂黑下的读数：sum=印数应等于它，touched=是否碰到黑，contact=邻黑格数 */
export function clueReading(f, i, blacks, o = {}) {
  o = opts(o);
  const comps = components(f.h, f.w, blacks);
  const at = new Int32Array(f.h * f.w).fill(-1);
  for (const cp of comps) for (const cell of cp.cells) at[cell] = cp.id;
  let sum = 0, contact = 0, touched = false;
  const seenArea = new Set();
  for (const q of neighbours(i, f.h, f.w)) {
    if (!blacks[q]) continue;
    contact++;
    touched = true;
    const cp = comps[at[q]];
    if (o.readA === 'contact') sum += 1;
    else if (o.readA === 'wrap') sum += cp.size;
    else { if (!seenArea.has(cp.id)) { seenArea.add(cp.id); sum += cp.size; } }
  }
  return { sum, contact, touched, areas: seenArea.size };
}

/** 白格（非黑格）是否整体正交连通 —— 全盘的、无部分状态的版本 */
export function whitesConnected(h, w, blacks) {
  const n = h * w;
  let start = -1, whites = 0;
  for (let i = 0; i < n; i++) if (!blacks[i]) { whites++; if (start < 0) start = i; }
  if (whites === 0) return false;
  const seen = new Uint8Array(n), st = [start];
  seen[start] = 1;
  let cnt = 1;
  while (st.length) {
    const i = st.pop();
    for (const q of neighbours(i, h, w)) if (!blacks[q] && !seen[q]) { seen[q] = 1; cnt++; st.push(q); }
  }
  return cnt === whites;
}

/**
 * verify(face, blacks, opt) → 违反记录数组；空数组 = 该涂黑满足引文的全部条款。
 * 一条 clause 一个 code，R1..R6 + B 开关的变体 R2b。
 */
export function verify(f, bs, o = {}) {
  o = opts(o);
  const V = [];
  const { h, w, c } = f, n = h * w;
  const rc = (i) => `${(i / w) | 0},${i % w}`;
  // R1 —— "Cells with numbers or question signs can not be blacken."
  for (let i = 0; i < n; i++) if (c[i] !== FREE && bs[i]) V.push({ code: 'R1', msg: `R1 clue-cell-blackened @${rc(i)}` });
  // R2 —— "Black cells form square areas"
  const comps = components(h, w, bs);
  const at = new Int32Array(n).fill(-1);
  for (const cp of comps) for (const x of cp.cells) at[x] = cp.id;
  for (const cp of comps) {
    const solid = cp.size === cp.side * cp.span;
    if (cp.side !== cp.span || !solid) V.push({ code: 'R2', msg: `R2 black-area-not-square @${rc(cp.cells[0])} bbox ${cp.side}x${cp.span} size ${cp.size}` });
    else if (cp.side === 1 && !o.allowSingle) V.push({ code: 'R2b', msg: `R2b 1x1-not-a-square-area @${rc(cp.cells[0])} (B=off)` });
  }
  // R3 —— "... that must not be orthogonally adjacent."
  for (let i = 0; i < n; i++) {
    if (!bs[i]) continue;
    for (const q of neighbours(i, h, w)) if (bs[q] && at[q] !== at[i]) V.push({ code: 'R3', msg: `R3 squares-orthogonally-adjacent @${rc(i)}/${rc(q)}` });
  }
  // R4 / R5 —— 线索读数。自己已被涂黑的线索只报 R1（见数据形状那段）。
  for (let i = 0; i < n; i++) {
    const v = c[i];
    if (v === FREE || bs[i]) continue;
    const { sum, touched } = clueReading(f, i, bs, o);
    if (v === QMARK) {
      if (!touched) V.push({ code: 'R5', msg: `R5 question-without-adjacent-black @${rc(i)}` });
    } else if (sum !== v) V.push({ code: 'R4', msg: `R4 number-clue-mismatch @${rc(i)} shows ${v} reads ${sum}` });
  }
  // R6 —— "All the white cells must be connected horizontally or vertically."
  const white = [];
  for (let i = 0; i < n; i++) if (!bs[i]) white.push(i);
  if (white.length === 0) V.push({ code: 'R6', msg: 'R6 no-white-cells' });
  else if (!whitesConnected(h, w, bs)) {
    const seen = new Uint8Array(n), st = [white[0]];
    seen[white[0]] = 1;
    let cnt = 1;
    while (st.length) { const i = st.pop(); for (const q of neighbours(i, h, w)) if (!bs[q] && !seen[q]) { seen[q] = 1; cnt++; st.push(q); } }
    V.push({ code: 'R6', msg: `R6 white-cells-disconnected ${cnt}/${white.length}` });
  }
  return V;
}

/**
 * 校验**声明式**的方形分解（出题器产出的形状）。R3 在这里是真的可反证的；
 * 在同一种涂黑上用极大分量的 verify() 去判，R3 永远打不着（相邻两区会并成一个非方形分量，
 * 于是只报 R2）—— 这条差异是刻意保留的见证，不是 bug。
 */
export function verifyAreas(f, areas, o = {}) {
  o = opts(o);
  const V = [];
  const { h, w } = f;
  const bs = new Uint8Array(h * w);
  const owner = new Int32Array(h * w).fill(-1);
  areas.forEach((a, k) => {
    if (a.s < 1) { V.push({ code: 'R2', msg: `R2 area-side<1 #${k}` }); return; }
    for (let r = a.r; r < a.r + a.s; r++) for (let j = a.j; j < a.j + a.s; j++) {
      if (r < 0 || r >= h || j < 0 || j >= w) { V.push({ code: 'R2', msg: `R2 area-out-of-grid #${k}` }); continue; }
      const i = r * w + j;
      if (f.c[i] !== FREE) V.push({ code: 'R1', msg: `R1 declared-area-covers-clue-cell @${r},${j}` });
      if (owner[i] >= 0 && owner[i] !== k) V.push({ code: 'R2', msg: `R2 areas-overlap #${owner[i]}/${k} @${r},${j}` });
      owner[i] = k; bs[i] = 1;
    }
  });
  for (let i = 0; i < h * w; i++) {
    if (owner[i] < 0) continue;
    for (const q of neighbours(i, h, w)) if (owner[q] >= 0 && owner[q] !== owner[i])
      V.push({ code: 'R3', msg: `R3 declared-areas-orthogonally-adjacent #${owner[i]}/${owner[q]} @${(i / w) | 0},${i % w}` });
  }
  return { violations: V, blacks: bs };
}

export function areasToBlacks(f, areas) {
  return verifyAreas(f, areas).blacks;
}
