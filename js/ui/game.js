// 局面状态 · 无 DOM —— 页面与浏览器闸共用同一份状态机
//
// 存在的理由：页面上任何"这盘合法吗 / 推得完吗 / 有几个解"的话都必须由引擎说出，
// 而 UI 里再写一份判定就是第二套口径（本题材最容易被写坏的就是"填满了就算赢"）。
// 所以本文件只做三件事：装盘、记账（涂黑/注白/擦除）、把引擎的答复翻译成状态。
//
// 出货条件在引擎那一侧（produce()：裁判证唯一 ∧ 铅笔零猜测推完），本文件**不重做**它，
// 也只转述它交回的凭证。produce 返回 !ok 时这里交出一个 reject 状态并把 receipt 原样带上 ——
// 宁可摊开"这一局号没出证"，也不发一张没证完的盘。

import { TIERS, produce, tierOf } from '../engine/generate.js';
import { BLK, CLAUSE_TEXT, DEFAULTS, FREE, QMARK, UNK, WHT, faceRows, faceTokens, verify } from '../engine/rules.js';
import { CLAUSES, RULES, pencilSolve } from '../engine/pencil.js';
import { countSolutions } from '../engine/counter.js';
import { seedOf } from '../engine/rng.js';

export { BLK, UNK, WHT };

export const CYCLE = [UNK, BLK, WHT];                 // 左键：未知 → 黑 → 白 → 未知
export const MARK_TEXT = { [UNK]: '未知', [BLK]: '黑', [WHT]: '白' };

/** 档位摘要：全部字段从 TIERS 现读，UI 里不许出现第二个档名或第二条线索区间。 */
export const tierList = () => TIERS.map((t) => ({
  key: t.key, label: t.label, size: `${t.h}×${t.w}`, band: t.band, steps: t.steps, target: t.target,
}));

const key = (tierKey, round) => `tasquare:v1:${tierKey}:${round}`;

/**
 * @param tierKey 档位键（必须在 TIERS 里，否则 tierOf 给 null ⇒ 这里抛）
 * @param round   局号：任意字符串，UI 用递增整数（不许由日期派生）
 * @param storage 可注入的持久层（浏览器传 localStorage，闸传内存 Map）
 */
export function makeGame(tierKey, round, storage = null) {
  const tier = tierOf(tierKey);
  if (!tier) throw new Error(`未知档位 ${tierKey}（TIERS 里有 ${TIERS.map((t) => t.key).join(', ')}）`);
  const seed = seedOf(tierKey, round);
  const result = produce(tierKey, round);
  const game = { tierKey, round, seed, tier, result, ok: result.ok === true };

  if (!game.ok) {
    // 拒盘：没有题面可画。receipt 原样转述，页面上要看得见失败原因与重抽次数。
    game.face = null;
    game.marks = null;
    game.reject = { fail: result.fail, draws: result.draws, receipt: result.receipt || null };
    return game;
  }

  const face = result.face;
  const n = face.h * face.w;
  const marks = new Uint8Array(n);                   // 全 UNK 开局
  game.face = face;
  game.marks = marks;
  game.answer = result.blacks;                       // 裁判交回的那张（页面永远不读它做判定）

  // ---- 续玩：只认与本题面同尺寸的存档；对不上就丢弃（宁可重开也不串盘）
  const raw = storage && storage.getItem(key(tierKey, round));
  if (raw) {
    try {
      const s = JSON.parse(raw);
      if (typeof s.marks === 'string' && s.marks.length === n && /^[012]+$/.test(s.marks)) {
        for (let i = 0; i < n; i++) marks[i] = s.marks.charCodeAt(i) - 48;
      }
    } catch { /* 坏档就重开 */ }
  }
  game.save = () => storage && storage.setItem(key(tierKey, round), JSON.stringify({ seed, marks: marks.join('') }));
  game.clear = () => { marks.fill(UNK); game.save(); };

  const playable = (i) => i >= 0 && i < n && face.c[i] === FREE;
  game.mark = (i, v) => { if (!playable(i) || !CYCLE.includes(v)) return false; marks[i] = v; game.save(); return true; };
  game.cycle = (i) => { if (!playable(i)) return false; marks[i] = CYCLE[(marks[i] + 1) % CYCLE.length]; game.save(); return true; };
  game.canEdit = (i) => playable(i);

  game.counts = () => {
    let black = 0, white = 0, unknown = 0;
    for (let i = 0; i < n; i++) {
      if (face.c[i] !== FREE) continue;
      if (marks[i] === BLK) black++; else if (marks[i] === WHT) white++; else unknown++;
    }
    return { black, white, unknown, free: black + white + unknown };
  };

  /** 整盘判定：只有"没有未知格"才谈得上合法与否 —— 半成品不给结论，也不给提示性报错。 */
  game.verdict = () => {
    const { unknown } = game.counts();
    if (unknown !== 0) return { full: false, legal: false, violations: [], unknown };
    const bs = new Uint8Array(n);
    for (let i = 0; i < n; i++) bs[i] = marks[i] === BLK ? 1 : 0;
    const V = verify(face, bs, DEFAULTS);
    return {
      full: true, legal: V.length === 0, unknown: 0,
      violations: V.map((v) => ({ code: v.code, msg: v.msg, text: CLAUSE_TEXT[v.code] || `[${v.code}]（文字表缺这一条）` })),
    };
  };

  /** 提示：铅笔在**纯题面**上（不吃玩家的前提）的下一条结论。 */
  game.hint = () => {
    const p = pencilSolve(face, DEFAULTS);
    for (const rec of p.ledger) {
      if (face.c[rec.i] !== FREE) continue;          // 线索格的 [R1] 白不是玩家要做的一步
      if (marks[rec.i] === rec.v) continue;          // 已经推对了
      return { i: rec.i, v: rec.v, rule: rec.rule, text: CLAUSES[rec.rule] || '', conflicts: p.conflicts.length, done: p.done, steps: p.steps };
    }
    return null;
  };

  /** 出货凭证上的数字由浏览器**现算一遍**（不是抄 receipt）：唯一性 + 与玩家那张逐格对照。 */
  game.certify = () => {
    const c = countSolutions(face, { ...DEFAULTS, limit: 2, nodeCap: 200_000, wantSolutions: true });
    const p = pencilSolve(face, DEFAULTS);
    let diff = 0;
    if (c.solutions.length) for (let i = 0; i < n; i++) if ((marks[i] === BLK) !== (c.solutions[0][i] === 1)) diff++;
    return {
      count: c.count, nodes: c.nodes, stopped: c.stopped, stoppedBy: c.stoppedBy, exact: c.exact,
      clues: faceTokens(face).flat().filter((t) => t !== '.').length,
      pencilDone: p.done, pencilSteps: p.steps, pencilUnknown: p.unknown, legalIfDone: p.legalIfDone,
      rules: RULES.filter((k) => p.fires[k] > 0).length,
      vsPlayer: game.counts().unknown === 0 ? diff : null,
      seed, tierKey,
    };
  };

  /** 跨引擎对账用的题面指纹：同一串 seed 在 node 与浏览器必须给出逐字节相同的题面。 */
  game.faceText = () => faceRows(face).join('/');

  return game;
}

/** 题面 → 单元格描述（页面只负责画，不负责解释规则）。 */
export function cellsOf(face) {
  const out = [];
  for (let r = 0; r < face.h; r++) for (let j = 0; j < face.w; j++) {
    const i = r * face.w + j, v = face.c[i];
    out.push({ i, r, j, clue: v !== FREE, qmark: v === QMARK, label: v === FREE ? '' : v === QMARK ? '?' : String(v) });
  }
  return out;
}

/** 供闸做拒盘 canary：把探针预算掐死，同一局号就会走 reject 分支。 */
export const rejectProbe = (tierKey, round) => produce(tierKey, round, { probe: { nodeCap: 40, msCap: Infinity } });
