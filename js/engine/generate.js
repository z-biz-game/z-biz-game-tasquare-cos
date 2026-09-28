// 出题器 · 铺方块 → 印读数 → 逐条裁线索 → 出货闸门
//
// 出货条件（本文件的**全部**判定都由这两条与门组成，缺一条就丢弃重铺）：
//   1) 裁判证书：countSolutions 在出货预算下**数到恰好 1**（stopped 不是读数，见 counter.js）
//   2) 铅笔证书：pencilSolve 零猜测推完（done ∧ legalIfDone=0），且推完那张逐格等于 1) 交回的解
// 不达标的盘**不卖**，也不许被写成"难盘"：筛选屏实测（2026-09-29）出货形状 63 盘里 16 盘推不完
// （8x8 全裁那批 0/3），而同一批几何**不裁**的 grown 控制盘 32/33 推得完 —— 也就是说"把线索裁到
// 唯一"这件事本身会把盘推到推不完，所以这道与门是有选择性的，不是永远点头的。
//
// 难度轴（**为什么 TIERS 不能按格子数排**）：
//   本品类里让一盘变难的不是盘多大，是**印了几条线索**。筛选屏沿一条最小化路径逐级往下测
//   （LADDER，8x8 固定盘形、只改线索数，每级都是裁判证书唯一的盘）：
//     rung 30+   n=33 零猜测推完 33/33 步 med=1.0 p95=2.0
//     rung 25-29 n=27            27/27          med=2.0 p95=2.0
//     rung 20-24 n=30            30/30          med=2.0 p95=3.0
//     rung 15-19 n=29            29/29          med=3.0 p95=4.0
//     rung 12-14 n=11            10/11          med=3.0 p95=4.0（推不完那张平均剩 30 格）
//     rung 10-11 n=5              4/5           med=3.0 p95=4.0
//     rung 9-    n=3              3/3           med=3.0 p95=3.0   <- **最底一级反转**
//   Spearman(线索数, 步数 | 推完的唯一解盘) rho=-0.8, n=136；对"推不完剩余格数"只有 -0.2。
//   最底一级反转（9 条以下反而 3/3 推得完）意味着：**档位的下界必须由实测定，不许顺着"线索越少越难"
//   外推**。所以本表的 targetClues 与 clamp 全部由 tools/balance.mjs 的量出来的分布写死，
//   而不是由这张表的想法决定要裁到几。
//
// 三处 load-bearing 语义（换掉任何一处都是换游戏，页面上必须披露，见 rules.js 文件头）：
//   printZero=true   印 0 合法。禁掉它，唯一盘产量从 7/12 掉到 3/12（筛选屏 KNOB 4.1 同向）。
//   allowSingle=true 1x1 是合法的"方形区"（关掉反而提高唯一盘产量，所以默认开）。
//   readA='area'     圈内数字 = 邻接黑区的格数**之和**（引文字面），不是社区常见的 contact
//                    （邻黑格个数）。同一位置两者是 4 与 1。
//
// 与筛选屏探针的两处**刻意**差异（其余逐行同构，tools/port-check.mjs 逐张对账）：
//   · 探针把读数 >9 的线索直接 skip（按单字符解析的必然结果），等于悄悄改了题面密度；本文件
//     默认全印（makeFace 吃空格分词的 token）。要复现旧行为：传 {maxPrint: 9}。
//   · 探针给每张盘新建一个 rngOf(seed+i)；本文件**一条随机流走到底**（seed 串 → rnd，铺块、
//     印数、裁序共用它）。理由：一个 seed 串 = 一张盘必须是可复现性口径的全部内容，
//     "每张盘换一个起点"会让 UI 里的"换一局"对不上任何公式。
//
// 随机数：本文件不出现 Math.random / Date / loadavg / Object 遍历序。所有排序的随机键都在
// sort **之前**抽成数据，比较器是纯函数（node 与 Chrome 的 sort 对相等元素次序不同）。

import { makeRng, shuffled, seedOf } from './rng.js';
import {
  FREE, QMARK, BLK, DEFAULTS, cloneFace, clueReading, verify, verifyAreas,
} from './rules.js';
import { countSolutions, auditSolutions } from './counter.js';
import { pencilSolve } from './pencil.js';

export const LAY_DEFAULTS = Object.freeze({ allowSingle: true, maxSide: 3, tries: 60 });
export const DENSITY = Object.freeze({ zero: 0.35, qShare: 0.3 });

// ------------------------------------------------------------------ 几何
/** 把 areas 摊成涂黑数组 */
export function flatBlacks(h, w, areas) {
  const b = new Uint8Array(h * w);
  for (const a of areas) for (let r = a.r; r < a.r + a.s; r++) for (let j = a.j; j < a.j + a.s; j++) b[r * w + j] = 1;
  return b;
}

/** 白格（含线索格）整体正交连通？—— [R6] 在**几何层**的前置检查（涂黑还没有线索之分） */
export function whitesConnected(h, w, b) {
  let start = -1, whites = 0;
  for (let i = 0; i < h * w; i++) if (!b[i]) { whites++; if (start < 0) start = i; }
  if (!whites) return false;
  const seen = new Uint8Array(h * w); const st = [start]; seen[start] = 1; let cnt = 1;
  while (st.length) {
    const i = st.pop(); const r = (i / w) | 0, j = i % w;
    for (const [dr, dc] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nr = r + dr, nc = j + dc;
      if (nr < 0 || nc < 0 || nr >= h || nc >= w) continue;
      const q = nr * w + nc;
      if (b[q] || seen[q]) continue;
      seen[q] = 1; cnt++; st.push(q);
    }
  }
  return cnt === whites;
}

/**
 * 随机铺若干互不共边的实心方块。返回 {areas, deadEnds} 或 null（一个都没铺下）。
 * 拒绝规则是**双份**的：occ（自己的格子）+ ban（自己的邻格），所以 [R3] 在铺的时候就被
 * 结构性保证，而不是铺完再检查 —— verifyAreas 仍然独立复核 R3（见下），因为"我保证过"
 * 和"另一条通道确认我保证了"是两件事。
 */
export function laySquares(h, w, rnd, { allowSingle = true, maxSide = 3, want = 4, tries = LAY_DEFAULTS.tries } = {}) {
  const occ = new Uint8Array(h * w), ban = new Uint8Array(h * w);
  const areas = [];
  let deadEnds = 0, guard = 0;
  const sides = [];
  for (let s = allowSingle ? 1 : 2; s <= maxSide; s++) sides.push(s);
  if (!sides.length) return null;
  while (areas.length < want && guard++ < tries) {
    const s = sides[(rnd() * sides.length) | 0];
    const r = (rnd() * (h - s + 1)) | 0, j = (rnd() * (w - s + 1)) | 0;
    const cells = [];
    let bad = false;
    for (let a = r; a < r + s && !bad; a++) for (let bq = j; bq < j + s; bq++) { const i = a * w + bq; if (occ[i] || ban[i]) { bad = true; break; } cells.push(i); }
    if (bad) { deadEnds++; continue; }
    for (const i of cells) {
      occ[i] = 1;
      const rr = (i / w) | 0, cc = i % w;
      for (const [dr, dc] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nr = rr + dr, nc = cc + dc;
        if (nr < 0 || nc < 0 || nr >= h || nc >= w) continue;
        ban[nr * w + nc] = 1;
      }
    }
    areas.push({ r, j, s });
  }
  if (!areas.length) return null;
  return { areas, deadEnds };
}

/**
 * 从铺好的几何**读出**题面：每个非黑格按 dens 的概率印上它的读数。
 * 注意印的是"这条格在**这块几何**下的读数"，所以题面与真解天生自洽（不需要事后修）。
 *   dens.zero    读到 0 的格子里，印出这个 0 的比例（printZero=false 时恒不印）
 *   dens.qShare  正读数格子里，改印 '?' 的比例（'?' 只要"至少邻一个黑格"，信息量低得多）
 * 返回 tooBig = 读数 > maxPrint 而被 skip 的格数：这条计数就是为了把"探针改了题面密度"
 * 这件事留在 receipt 里，而不是留在注释里。
 */
export function readAndPrint(h, w, areas, rnd, sw = {}, dens = DENSITY, { maxPrint = Infinity } = {}) {
  const bs = flatBlacks(h, w, areas);
  const f = { h, w, c: new Int32Array(h * w).fill(FREE) };
  let zeroCells = 0, posCells = 0, printed = 0, tooBig = 0;
  const probe = { ...DEFAULTS, ...sw };
  for (let i = 0; i < h * w; i++) {
    if (bs[i]) continue;
    const { sum, touched } = clueReading(f, i, bs, probe);
    if (!touched) {
      zeroCells++;
      if (probe.printZero && rnd() < dens.zero) { f.c[i] = 0; printed++; }
      continue;
    }
    posCells++;
    if (rnd() < dens.qShare) { f.c[i] = QMARK; printed++; continue; }
    if (sum > maxPrint) { tooBig++; continue; }
    f.c[i] = sum; printed++;
  }
  return { face: f, blacks: bs, zeroCells, posCells, printed, tooBig };
}

/**
 * 一步到位：铺几何 → 复核 → 印题面。返回 null 时 fail 说明死在哪一步（记账用，
 * 不许把它当成"这盘很难"）。
 *
 * 复核走的是**两条独立通道**，不是走个形式：
 *   · verifyAreas(声明的分解) —— [R3]（区不共边）在这里才是可反证的；用极大分量判定时
 *     两块共边的区会并成一个非方形分量，只会报 R2，永远报不出 R3（rules.js §5 钉过这条不对称）。
 *   · verify(整盘 + 摊平的涂黑) —— [R1][R2][R4][R5][R6] 对着**印出来的题面**判。
 * 早班的 `min` 读数之所以能逐字节复现，靠的就是这两条都没被改过。
 */
export function growFace(h, w, rnd, sw = {}, dens = DENSITY, wantAreas = null, { maxPrint = Infinity } = {}) {
  const allowSingle = sw.allowSingle ?? DEFAULTS.allowSingle;
  const lay = laySquares(h, w, rnd, {
    allowSingle,
    maxSide: sw.maxSide ?? LAY_DEFAULTS.maxSide,
    want: wantAreas ?? (3 + ((rnd() * (h + w)) | 0)),
  });
  if (!lay) return { ok: false, fail: 'lay' };
  const bs = flatBlacks(h, w, lay.areas);
  if (!whitesConnected(h, w, bs)) return { ok: false, fail: 'whites' };
  const r = readAndPrint(h, w, lay.areas, rnd, sw, dens, { maxPrint });
  const declared = verifyAreas(r.face, lay.areas, sw);
  if (declared.violations.length) return { ok: false, fail: 'verifyAreas', violations: declared.violations.map((v) => v.msg) };
  if (verify(r.face, r.blacks, sw).length) return { ok: false, fail: 'verify' };
  if (r.printed === 0) return { ok: false, fail: 'noClue' };
  return { ok: true, face: r.face, blacks: r.blacks, areas: lay.areas, deadEnds: lay.deadEnds, printed: r.printed, zeroCells: r.zeroCells, posCells: r.posCells, tooBig: r.tooBig };
}

// ------------------------------------------------------------------ 裁线索
/**
 * 沿随机序逐条试删：**删掉后裁判仍证明唯一**才真删（探针预算比出货预算小一个数量级，
 * 因为一张 8x8 要试 30+ 次）。target 是"裁到几条就停手"（档位难度），Infinity = 裁到不可约。
 *
 * 探针击穿（stopped）时这条线索**不许删** —— 方向安全：最坏是多印一条线索，绝不会少印，
 * 所以击穿绝不会产出一个可能不唯一的答案。keptByBudget 就是这笔账，receipt 里单独记账，
 * 不与"证明过多余"（removed）合并成一个数字。
 */
export function carve(face, shipOpt, { target = Infinity, probe = {}, rnd } = {}) {
  const f = cloneFace(face);
  const opt = { ...shipOpt, ...probe };
  const order = shuffled(clueIndices(f), rnd);
  let removed = 0, probes = 0, keptByBudget = 0, necessary = 0;
  for (const i of order) {
    if (clueCount(f) <= target) break;
    const saved = f.c[i];
    f.c[i] = FREE;
    const c = countSolutions(f, { ...opt, limit: 2 });
    probes++;
    if (c.stopped) { f.c[i] = saved; keptByBudget++; continue; }
    if (c.count === 1) removed++;
    else {
      // 删掉之后不唯一（count>=2；不可能数到 0，删线索不会消灭已有的解）：必需线索
      f.c[i] = saved;
      necessary++;
    }
  }
  return { face: f, removed, probes, keptByBudget, necessary, clues: clueCount(f) };
}

export const clueCount = (f) => { let k = 0; for (let i = 0; i < f.c.length; i++) if (f.c[i] !== FREE) k++; return k; };
export const clueIndices = (f) => { const out = []; for (let i = 0; i < f.c.length; i++) if (f.c[i] !== FREE) out.push(i); return out; };

// ------------------------------------------------------------------ 出货
/**
 * 一张盘的完整生产路径。返回 {ok:true, face, blacks, receipt} 或 {ok:false, fail, receipt}。
 *
 * blacks 一律由**裁判交回的那个唯一解**回填（wantSolutions:true），不用生成器自己记的几何：
 * 裁线索会改变题面，生成器铺下去的那份涂黑在裁完之后**不再是任何解**的证人了 —— 这条在
 * Yajilin 上真的烧过一次（补/挖线索之后 board.black 与所有解都不符）。所以出货时刻的
 * 真值只认 counter.solutions[0]，并且再过一遍整盘 verify。
 *
 * fail 的取值就是 receipt 的账：'lay'/'whites'/'verify'/'noClue'（几何与题面自洽层）、
 * 'cert-*'（ grown 面没证到唯一）、'ship-*'（裁完之后出货裁判没证到唯一）、
 * 'pencil'（铅笔推不完 —— 本品类里最常见的一档）、'truth'（铅笔与裁判给的解不是同一张）、
 * 'draws'（重抽次数用光）。
 */
export function produceBoard(h, w, rnd, cfg = {}) {
  const {
    sw = {}, dens = DENSITY, target = Infinity, maxPrint = Infinity,
    ship = { nodeCap: 200_000, msCap: Infinity }, probe = { nodeCap: 40_000, msCap: Infinity },
    maxDraws = 400, wantAreas = null,
  } = cfg;
  const receipt = { draws: 0, layFails: {}, layTried: 0, certTried: 0, certRejected: 0, certStopped: 0, printed: 0, cluesBefore: 0, clues: 0, removed: 0, keptByBudget: 0, necessary: 0, probes: 0, certNodes: 0, certMs: 0, shipNodes: 0, shipMs: 0, shipRuns: 0, shipStoppedBy: null, pencilSteps: 0, pencilSweeps: 0, pencilUnknown: 0, tooBig: 0 };
  let draws = 0;
  for (; draws < maxDraws; draws++) {
    const g = growFace(h, w, rnd, sw, dens, wantAreas, { maxPrint });
    if (!g.ok) { receipt.layFails[g.fail] = (receipt.layFails[g.fail] || 0) + 1; continue; }
    receipt.layTried++;
    receipt.printed = g.printed; receipt.tooBig = g.tooBig;
    const cert = countSolutions(g.face, { ...ship, limit: 2, mrv: true, wantSolutions: true });
    receipt.certNodes = Math.max(receipt.certNodes, cert.nodes);
    receipt.certMs = Math.max(receipt.certMs, cert.ms);
    receipt.shipRuns++; receipt.certTried++;
    if (cert.stopped) { receipt.certStopped++; continue; }        // 撞预算不是"这盘不唯一"，分开记
    if (cert.count !== 1) { receipt.certRejected++; continue; }   // 数到 2 =  grown 面本来就多解
    if (auditSolutions(g.face, cert, sw)) continue;
    receipt.cluesBefore = clueCount(g.face);
    const cv = carve(g.face, sw, { target, probe, rnd });
    receipt.removed = cv.removed; receipt.probes = cv.probes;
    receipt.keptByBudget = cv.keptByBudget; receipt.necessary = cv.necessary;
    receipt.clues = cv.clues;
    const ship1 = countSolutions(cv.face, { ...ship, limit: 2, mrv: true, wantSolutions: true });
    receipt.shipNodes = Math.max(receipt.shipNodes, ship1.nodes);
    receipt.shipMs = Math.max(receipt.shipMs, ship1.ms);
    receipt.shipRuns++;
    if (ship1.stopped) {
      // 红必须点名它的闸：'ship-stopped' 不带归因的话，读日志的人分不清是节点预算不够还是钟被踩
      receipt.shipStoppedBy = ship1.stoppedBy;
      return { ok: false, fail: 'ship-stopped', draws, receipt, board: cv.face };
    }
    if (ship1.count !== 1) return { ok: false, fail: 'ship-not-unique', draws, receipt, board: cv.face };
    const p = pencilSolve(cv.face, sw);
    receipt.pencilSteps = p.steps; receipt.pencilSweeps = p.sweeps; receipt.pencilUnknown = p.unknown;
    if (!p.done || p.legalIfDone !== 0) return { ok: false, fail: 'pencil', draws, receipt, board: cv.face };
    let mismatch = 0;
    for (let i = 0; i < cv.face.c.length; i++) if ((p.st[i] === BLK) !== (ship1.solutions[0][i] === 1)) mismatch++;
    if (mismatch) return { ok: false, fail: 'truth', draws, receipt, board: cv.face };
    receipt.draws = draws + 1;
    return {
      ok: true, h, w, face: cv.face, blacks: ship1.solutions[0], seed: null,
      clues: cv.clues, areas: g.areas, receipt,
    };
  }
  return { ok: false, fail: 'draws', draws, receipt };
}

// ------------------------------------------------------------------ 成本口径
/**
 * 生产路径上**没有任何一步判定吃墙钟**：ship 与 carve 的预算只有 nodeCap，msCap 一律 Infinity。
 * A 节把这条钉成结构不变量（谁把钟放回生产表，balance 立刻红）。
 *
 * 为什么本品类敢这么定（数字是 2026-09-29 两批 n=60/档 的实测：tasquare| 批与 price| 批，
 * 两条复跑命令都写在 balance.mjs 文件头）：
 *   · 单张盘最贵的裁判调用（出货证书）落在 8x8 不可约档，两批 max 1,338 / 966 节点；6x6 两档
 *     max 100–210。预算 200,000 是最坏读数的 **149 倍**余量 —— 节点闸本身就是够硬的保险丝。
 *   · 整盘生产墙钟：八个数里 p95 最大 2.6 ms、max 4.6 ms。ms 在这个量级上既不会救场也拦不住
 *     任何东西，只会把"机器的速度"变成"画哪张盘"。
 *   · 更强的一条，是量出来的而不是想出来的：**探针上挂钟根本打不出击穿**。counter.js 每 256 个
 *     节点才查一次钟，而裁线索的单次探针搜索实测都在 256 节点以内 —— balance 的 E1 起初就是用
 *     msCap=0.0005 写的，结果 0/6 对触发（一条打不着的闸做不了负控）。所以"生产表里没有钟"
 *     没有减少任何保护，只是把一条本来就够不着的闸从判定路径上拿掉；E1 因此改掐节点。
 *   · 一条 seed 流 = 一串确定数值 ⇒ 一次抽卡（见 produceBoard：carve 只吃一次 shuffled(...)）。
 *     判定里没有任何由时间派生的量，所以"同一串 ⇒ 同一张盘"在 node 与 Chrome 上是同一条定理，
 *     而不是一次观察。D 节测它，E1 顺便测"预算参与的口径"确实是预算而不是速度。
 *   · msCap 作为**选项**仍实现于 counter.js（保险丝没被删掉，只是不在生产路径上）：按 counter.js
 *     自己的查钟口径，只有节点数过了 256 的搜索才可能被钟打断，而上面那行读数说明生产里唯一会
 *     过 256 的是 8x8 深档的出货证书 —— 它对节点预算有 149 倍余量，打断它等于先打断自己。
 */

/**
 * 档位表。target / band / 预算都由 tools/balance.mjs 实测定价（两批 n=60/档：seed 串
 * `price|<档>|<局号>` 与 `tasquare|<档>|<局号>`，两批的读数都在每档注释里各列一份）。
 *
 * 为什么有两档共用 8x8、两档共用 6x6：**难度轴是线索数，不是格子数**（文件头 LADDER，
 * rho=-0.8 n=136）。同一尺寸放两档正好让"同一批几何、只差印刷线索数"成为可比对照
 * （balance 的 C 节就是把同尺寸的相邻两档摆在一起比步数分布）。
 *
 * 实测到的**饱和点**决定了"深裁档"到底裁到哪里（这条是本次测量推翻我原先想法的地方）：
 *   原以为"目标越低越难"。量出来是：目标降到饱和点以下，出货盘的线索数**不再下降** —— 因为再删
 *   就不唯一了。最干净的形式在 balance 的 H 节：**同一串 seed**（pair|<档>|<局号>，同一批几何、
 *   同一裁序）只换停止规则，n=60 时"要 0 条"与"要 4 条"在 6x6 上 40/41 对、8x8 上 49/49 对出货
 *   的是**一字不差的那张盘**；而"要 8 条"与"要 18 条"没有一对相同（中位差 7–10 条）。
 *   也就是说 target=4 是一个不存在的旋钮，target=8/18 才是。所以"深裁档"的语义只能命名为
 *   **不可约**（每条幸存线索都被现删现数证明删不掉，F 节），不能是"裁到 N 条"。这两档的
 *   target 因此写 0，档位名里也不出现任何"低到饱和点以下"的数字。
 *
 * @property {string}  key       seed 串里的档位标识（rng.js::seedOf）
 * @property {number}  target    裁到"线索数 ≤ target"就停手；0 = 裁到不可约
 * @property {[number,number]} band 出货线索数的承诺区间（**档位的定义**；实测值在每档注释里，
 *                      区间留了单侧余量但不留"想法余量"。下界尤其要紧：越裁不等于越难）
 * @property {[number,number]} steps 铅笔步数承诺区间（上界是实测 max + slack，见"承诺不是想法"）
 * @property {object}  ship      出货裁判预算（只 nodeCap）
 * @property {object}  carve     探针预算（只 nodeCap；比 ship 小一个数量级，击穿 ⇒ 多留一条线索）
 * @property {number}  maxDraws  重抽上限（保险丝：实测 max draws 见注释，与它有 1–2 个数量级余量）
 * @property {object}  yieldFloor 实测出货率下界（balance 用它判红；低于它=这一档根本产不出盘）
 */
export const TIERS = Object.freeze([
  {
    key: 'easy-6x6', label: '入门 · 6×6', h: 6, w: 6, target: 18,
    band: [13, 20], steps: [1, 7], ship: { nodeCap: 200_000, msCap: Infinity },
    carve: { nodeCap: 40_000, msCap: Infinity }, maxDraws: 400, dens: { zero: 0.35, qShare: 0.3 },
    yieldFloor: 0.75,
    // 两批 n=60/档 实测（2026-09-29，tasquare| 批 / price| 批，复跑命令见 balance.mjs 文件头）：
    //   出货率 98% / 98%（失败原因只有 pencil）· clues 15–18 / 14–18（med 18 / 18）
    //   steps 1–4 / 1–3 · 探针 0–5 / 0–6 · draws max 10 / 11 · 证书节点 max 100 / 119
    //   整盘墙钟 p95 0.86 / 0.81 ms（max 4.6 / 3.3）· 探针击穿 0
  },
  {
    key: 'irr-6x6', label: '挑战 · 6×6 不可约', h: 6, w: 6, target: 0,
    band: [3, 12], steps: [2, 8], ship: { nodeCap: 200_000, msCap: Infinity },
    carve: { nodeCap: 40_000, msCap: Infinity }, maxDraws: 400, dens: { zero: 0.35, qShare: 0.3 },
    yieldFloor: 0.55,
    // 两批 n=60 实测（tasquare| / price|）：出货率 80% / 80%（失败只有 pencil）
    //   clues 3–10 / 4–12（med 6 / 6）· steps 2–6 / 2–7 · 探针 15–23 / 15–25 · draws max 18 / 10
    //   证书节点 max 210 / 201 · 整盘 ms p95 0.96 / 0.93（max 1.2 / 1.2）· 击穿 0
    //   band 两侧都正好压在实测支撑集上（下 3 / 上 12 各被一批摸到边）—— 这不是忘了留余量：
    //   seed 局号是固定整数，出货线索数不会随机漂，越界只可能由代码改动引起，而那正是要红的时刻。
  },
  {
    key: 'mid-8x8', label: '进阶 · 8×8', h: 8, w: 8, target: 18,
    band: [15, 24], steps: [1, 8], ship: { nodeCap: 200_000, msCap: Infinity },
    carve: { nodeCap: 40_000, msCap: Infinity }, maxDraws: 600, dens: { zero: 0.35, qShare: 0.3 },
    yieldFloor: 0.65,
    // 两批 n=60 实测（tasquare| / price|）：出货率 85% / 90%（失败只有 pencil）
    //   clues 两批都 min=max=18 ⇒ 这一档的"18 条"是硬承诺而不是分布中心（band 15–24 两侧各留 3/6 余量）
    //   steps 2–6 / 1–5 · 探针 15–40 / 12–32 · 必需线索 med 4 / 4（max 18 / 11）· draws max 20 / 13
    //   证书节点 max 394 / 411 · 整盘 ms p95 2.0 / 2.0（max 2.8 / 2.9）· 击穿 0
  },
  {
    key: 'irr-8x8', label: '烧脑 · 8×8 不可约', h: 8, w: 8, target: 0,
    band: [6, 22], steps: [1, 10], ship: { nodeCap: 200_000, msCap: Infinity },
    carve: { nodeCap: 40_000, msCap: Infinity }, maxDraws: 600, dens: { zero: 0.35, qShare: 0.3 },
    yieldFloor: 0.50,
    // 两批 n=60 实测（tasquare| / price|）：出货率 67% / 65%（失败只有 pencil）· 四档里最低，
    //   因为不可约 + 8×8 的盘最常出现"唯一解但零猜测推不完"（20–21/60 被铅笔拒掉，不卖）
    //   clues 7–15 / 7–17（med 11 / 12）· steps 2–9 / 2–8 · 探针 28–40 / 29–42 · draws max 13 / 11
    //   证书节点 p95 1150 / 726 · max 1338 / 966（全仓最贵的一次裁判调用，预算 200,000 = 149 倍）
    //   整盘 ms p95 2.5 / 2.6（max 4.3 / 3.3）· 击穿 0
  },
]);


export const tierOf = (key) => TIERS.find((t) => t.key === key) || null;

/** 生产入口：吃 seed 串（见 rng.js），产出一张过闸的盘或诚实的失败。 */
export function produce(tierKey, seed, overrides = {}) {
  const t = tierOf(tierKey);
  if (!t) throw new Error(`未知档位 ${tierKey}（ TIERS 里有 ${TIERS.map((x) => x.key).join(', ')}）`);
  const seedStr = typeof seed === 'object' && seed && seed.rawSeed ? seed.rawSeed : seedOf(tierKey, seed);
  const cfg = {
    sw: { ...DEFAULTS },
    dens: t.dens,
    target: t.target,
    ship: t.ship,
    probe: t.carve,
    maxDraws: t.maxDraws,
    ...overrides,
  };
  const out = produceBoard(t.h, t.w, makeRng(seedStr), cfg);
  out.seed = seedStr;
  out.tier = tierKey;
  return out;
}
