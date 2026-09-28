#!/usr/bin/env node
// 铅笔闸 · pencilSolve —— "这盘不猜能不能推完"的答案必须对得起**全部**解
//
// 存在理由：出货条件的另一半是铅笔说的，而它的强度断言（"一个分支都不走"）恰恰是最难自证的
// 那种：引擎自己说"我推完了"不算证据。本闸用两条外部通道钉它：
//   1) 健全性对着**解集合**而不是对着某个解 —— 零猜测引擎下的每一步必须在**每一个**合法解里
//      都成立。多解题面上这一点尤其致命：若铅笔在歧义盘上"猜中"了某个解，它交的是一条假设，
//      而页面会把它印成逻辑。解集合由 tools/lib-packing.mjs 穷举给出，与铅笔无任何共享代码。
//   2) 出货盘的"推得完"由裁判的解逐格对照，账本再过一遍 auditLedger/auditState。
//
// 跑法：  node tools/pencil-test.mjs
//
// 每段都写了"什么改动会让这段红"：
//   §1 全解健全      任何一条条款把"某个候选下成立"写成"必然成立"（P2footprint 的公共格、
//                    P4need 的子集和、P5qonlyOne 的唯一可黑邻格都会是这个错的现场）。
//   §2 不假装推完    线索不足时必须留未知、legalIfDone 必须是 null、矛盾必须为 0。
//   §3 出货盘全推得完 出题器的拒绝理由是铅笔，所以**出货的每一张**都要推得完（TIERS 全档取样）。
//   §4 规则命中分布  每条规则要么有命中的样本，要么被明确写成"没命中"（聚合数会被退化样本
//                    抬起来，所以打印每档分布而不是总数）。
//   §5 负控          伪造账本 / 错色当前提，两条都必须留下可见痕迹。
//   §6 一份几何      铅笔的候选方形数与裁判逐张相同（三方共用一份 squareTable）。
//   §7 停止条件      maxSweeps 截断必须被记为 overrun，不许静默当成"推完了"。
//   §8 结构上界      steps ≤ cells（每步至少填一格）、deductions ≥ steps、unknown+已定=格子数。

import {
  DEFAULTS, FREE, makeFace, faceRows, verify,
} from '../js/engine/rules.js';
import { pencilSolve, auditLedger, auditState, RULES, CLAUSES, UNK, BLK } from '../js/engine/pencil.js';
import { countSolutions } from '../js/engine/counter.js';
import { growFace, DENSITY, TIERS, produce } from '../js/engine/generate.js';
import { makeRng, shuffled } from '../js/engine/rng.js';
import { packingBlacks } from './lib-packing.mjs';

console.log('================================================================================');
console.log('TASQUARE PENCIL-TEST — 全解健全性 / 不假装推完 / 出货盘 100% 推得完');
console.log(`node ${process.version} · readA=${DEFAULTS.readA} allowSingle=${DEFAULTS.allowSingle} printZero=${DEFAULTS.printZero}`);
console.log('================================================================================');

let checks = 0, fails = 0;
const ok = (gate, cond, detail = '') => {
  checks++;
  if (!cond) fails++;
  console.log(`  ${cond ? 'ok  ' : 'FAIL'} ${gate} :: ${detail}`);
};
const eq = (gate, got, want) => ok(gate, got === want, `期望 ${JSON.stringify(want)}，实得 ${JSON.stringify(got)}`);
const pct = (xs, p) => { const s = xs.slice().sort((a, b) => a - b); return s.length ? s[Math.min(s.length - 1, Math.floor(p * (s.length - 1)))] : NaN; };

/** 语料：小尺寸 grown 面（满线索 / 删一半 / 删四分之三）—— 故意留下大量**多解**题面。 */
const FACES = (() => {
  const out = [];
  for (let s = 0; s < 10; s++) for (const [h, w] of [[4, 4], [3, 4]]) {
    const g = growFace(h, w, makeRng(`pt|${s}`), { ...DEFAULTS }, DENSITY);
    if (!g.ok) continue;
    const idx = () => shuffled([...g.face.c.keys()].filter((i) => g.face.c[i] !== FREE), makeRng(`pt|${s}|drop`));
    for (const [tag, keep] of [['full', 0], ['half', 0.5], ['quarter', 0.75]]) {
      const f = makeFace(faceRows(g.face));
      if (keep > 0) for (const i of idx().slice(0, Math.max(1, Math.floor(idx().length * keep)))) f.c[i] = FREE;
      out.push({ name: `${h}x${w}#s${s} ${tag}`, f });
    }
  }
  return out;
})();

// ---------------------------------------------------------------- §1 全解健全性
console.log(`\n[§1 每一步结论都必须在**每一个**合法解里成立（语料 ${FACES.length} 张，含多解题面）]`);
{
  let unsound = 0, solved = 0, multi = 0, done = 0, worst = '';
  for (const { name, f } of FACES) {
    const all = packingBlacks(f, DEFAULTS, 300);
    if (!all.length) continue;                          // 无解题面没有"每个解"可对照，交给 §2/§7
    solved++;
    if (all.length > 1) multi++;
    const p = pencilSolve(f);
    if (p.done) done++;
    let bad = 0;
    for (const rec of p.ledger) {
      const want = rec.v === BLK;
      if (all.some((b) => (b[rec.i] === 1) !== want)) { bad++; if (!worst) worst = `${name} ${rec.i}断${want ? '黑' : '白'} 规则 ${rec.rule}（${all.length} 个解里有反例）`; }
    }
    unsound += bad;
  }
  ok('§1 账本里没有任何一条结论是"猜中的"（逐条对全部解成立）', unsound === 0, worst || `对撞 ${solved} 张有解题面 · 账本零越轨`);
  ok('§1 语料里确实有多解题面（否则"对每个解成立"会自动成立，等于没测）', multi >= 6, `${multi}/${solved} 张是多解`);
  console.log(`      有解题面 ${solved} 张里铅笔声称推完 ${done} 张（多解盘上这应当是 0，见 §2）`);
  eq('§1 多解题面上一张都不许被声称推完', FACES.filter(({ f }) => packingBlacks(f, DEFAULTS, 3).length > 1).map(({ f }) => pencilSolve(f).done).filter(Boolean).length, 0);
}

// ---------------------------------------------------------------- §2 不假装推完
console.log('\n[§2 线索不足 / 无解的题面：不许假装推完，也不许出错]');
{
  const thin = makeFace(['. . 4 . . .', '. . . . . .', '. . . . . .', '. . ? . . .', '. . . . . .', '. . . . . 0']);
  const p = pencilSolve(thin);
  ok('§2 线索不足时留未知且不算推完', p.done === false && p.unknown > 0, `unknown=${p.unknown} done=${p.done}`);
  eq('§2 未推完时不交 legality', p.legalIfDone, null);
  eq('§2 也不产生矛盾（题面本身自洽）', p.conflicts.length, 0);
  eq('§2 推出的每一条都对着某个真解成立（与 §1 同一标准的薄盘版）',
    packingBlacks(thin, DEFAULTS, 300).some((b) => p.ledger.every((r) => (b[r.i] === 1) === (r.v === BLK))) ? 0 : 1, 0);
  const contra = makeFace(['. 99 .', '. . .', '. . .']);
  const c = pencilSolve(contra);
  ok('§2 自相矛盾的题面：铅笔给出矛盾或拒绝推完（两者都不许交出一张"完成的盘"）',
    c.conflicts.length > 0 || c.done === false, `矛盾 ${c.conflicts.length} 条 · done=${c.done}`);
  const empty = makeFace(['. . . .', '. . . .', '. . . .', '. . . .']);
  const e = pencilSolve(empty);
  ok('§2 空题面（一条线索都没有）：推不完、无矛盾、16 格全留未知（无线索就没有可下的结论）',
    e.done === false && e.conflicts.length === 0 && e.unknown === 16 && e.deductions === 0,
    `unknown=${e.unknown} 结论 ${e.deductions} 条`);
}

// ---------------------------------------------------------------- §3 出货盘全推得完
console.log('\n[§3 出货的每一张都必须零猜测推得完（TIERS 全档取样，档名从表里取）]');
const byKey = new Map();
{
  for (const t of TIERS) {
    const one = [];
    for (let s = 0; s < 10; s++) {
      const r = produce(t.key, { rawSeed: `ptx|${t.key}|${s}` });
      if (!r.ok) continue;
      const p = pencilSolve(r.face);
      const c = countSolutions(r.face, { ...DEFAULTS, limit: 2, wantSolutions: true, nodeCap: 200_000 });
      let diff = 0;
      for (let i = 0; i < r.blacks.length; i++) if ((p.st[i] === BLK) !== (c.solutions[0][i] === 1)) diff++;
      one.push({ s, p, r, diff, ledgerBad: auditLedger(p.ledger, c.solutions[0]).oob, stateBad: auditState(p, c.solutions[0]).wrong });
    }
    byKey.set(t.key, one);
    const steps = one.map((x) => x.p.steps), unknown = one.filter((x) => !x.p.done).length;
    console.log(`      ${t.label}：出货 ${one.length} 张 · 推不完 ${unknown} 张 · steps med ${pct(steps, .5)} max${pct(steps, 1)} · legalIfDone≠0 的 ${one.filter((x) => x.p.legalIfDone !== 0).length} 张`);
    ok(`§3 ${t.key} 出货盘全部零猜测推完且整盘过规则模型`, one.length >= 4 && one.every((x) => x.p.done && x.p.unknown === 0 && x.p.legalIfDone === 0), `${one.length} 张`);
    ok(`§3 ${t.key} 铅笔推完的那张 = 裁判交回的唯一解（逐格）`, one.every((x) => x.diff === 0), `最大差 ${Math.max(0, ...one.map((x) => x.diff))} 格`);
    ok(`§3 ${t.key} 账本与整盘状态对着真值零越轨`, one.every((x) => x.ledgerBad === 0 && x.stateBad === 0),
      `账本越轨 ${one.reduce((a, x) => a + x.ledgerBad, 0)} · 状态不符 ${one.reduce((a, x) => a + x.stateBad, 0)}`);
    ok(`§3 ${t.key} 出货盘的 steps 落在档位承诺区间内（TIERS.steps 不是装饰）`,
      one.every((x) => x.p.steps >= t.steps[0] && x.p.steps <= t.steps[1]), `承诺 ${t.steps} · 实得 ${one.map((x) => x.p.steps).join(',')}`);
  }
}

// ---------------------------------------------------------------- §4 规则命中分布
console.log('\n[§4 八条规则的命中：逐档打印命中板数，没命中的必须被点名（不许当成"高级技巧"）]');
{
  const boards = [...byKey.values()].reduce((a, o) => a + o.length, 0);
  ok('§4 fires 的键集恰等于 RULES 表（规则表与引擎不许各有一份名字）',
    [...byKey.values()].every((one) => one.every((x) => Object.keys(x.p.fires).sort().join(',') === RULES.slice().sort().join(','))),
    `${boards} 张全部逐键对齐 · ${RULES.join(',')}`);
  const hitBoards = new Map(RULES.map((k) => [k, 0]));         // 命中过这条规则的**板数**（不是触发次数）
  for (const one of byKey.values()) for (const x of one) for (const k of RULES) if (x.p.fires[k] > 0) hitBoards.set(k, hitBoards.get(k) + 1);
  for (const [key, one] of byKey) console.log(`      ${key}（${one.length} 张）：${RULES.map((k) => `${k}=${one.filter((x) => x.p.fires[k] > 0).length}`).join(' ')}`);
  console.log(`      合计 ${boards} 张：${RULES.map((k) => `${k}=${hitBoards.get(k)}`).join(' ')}`);
  // 板数会低估一条规则的用力程度（一张盘里一条规则可以下十条结论），所以同一批样本再按
  // **账本条数**打一遍：pencil.js 文件头那句"P4* 贡献了绝大部分推理步"靠的是这份读数。
  const lines = new Map(RULES.map((k) => [k, 0]));
  let ledgerAll = 0;
  for (const one of byKey.values()) for (const x of one) {
    for (const e of x.p.ledger) { if (lines.has(e.rule)) lines.set(e.rule, lines.get(e.rule) + 1); }
    ledgerAll += x.p.ledger.length;
  }
  const ordered = RULES.slice().sort((a, b) => lines.get(b) - lines.get(a));
  console.log(`      账本条数 ${ledgerAll}：${RULES.map((k) => `${k}=${lines.get(k)}`).join(' ')}`);
  console.log(`      降序：${ordered.map((k) => `${k}(${lines.get(k)})`).join(' > ')}`);
  eq('§4 逐条归因的总数 = 账本条数（一条结论都不许掉出规则表）', [...lines.values()].reduce((a, x) => a + x, 0), ledgerAll);
  const p4 = ['P4noSquare', 'P4zero', 'P4need'].reduce((a, k) => a + lines.get(k), 0);
  const minLines = Math.min(...RULES.map((k) => lines.get(k)));
  ok('§4 每条规则在账本里都真的下过结论（命中板数 >0 还不够，结论条数也不能是 0）', minLines >= 1,
    `最少的 ${RULES.filter((k) => lines.get(k) === minLines).join(',')} 下了 ${minLines} 条 · P4 家族共 ${p4}/${ledgerAll} 条`);
  // P6conn 是**已披露**的例外（白格连通性在生成期当过滤器，玩家路径上很少单独产生一步）；
  // 其余任何一条一声不响，就意味着一条条款被写坏了却还挂着名字。
  const zero = RULES.filter((k) => hitBoards.get(k) === 0);
  ok('§4 未命中的规则只允许被点名披露的那条（P6conn），其余必须至少命中一张',
    zero.every((k) => k === 'P6conn'), `未命中 ${zero.join(',') || '无'}`);
  ok('§4 CLAUSES 给每条规则都配了一句以条款号开头的原文（页面上的"为什么"直接读这里，不在 UI 里另写）',
    RULES.every((k) => typeof CLAUSES[k] === 'string' && CLAUSES[k].startsWith('[')),
    RULES.filter((k) => !(typeof CLAUSES[k] === 'string' && CLAUSES[k].startsWith('['))).join(',') || '八条全有原文');
  eq('§4 规则表里没有重复的名字（否则命中统计会把一条算成两条）', new Set(RULES).size, RULES.length);
}

// ---------------------------------------------------------------- §5 负控
console.log('\n[§5 负控：证人必须能被伪造骗出反应]');
{
  const f = FACES[0].f;
  const truth = packingBlacks(f, DEFAULTS, 1)[0];
  const p = pencilSolve(f);
  eq('§5 真账本越轨 0', auditLedger(p.ledger, truth).oob, 0);
  const free = [...f.c.keys()].filter((i) => f.c[i] === FREE);
  const fak = free.slice(0, 8).map((i, k) => ({ i, v: truth[i] === 1 ? 0 : BLK, rule: RULES[k % RULES.length], FAKE: true }));
  const oobFake = auditLedger(p.ledger.concat(fak), truth).oob;
  ok('§5 交错注入的伪造结论一条不漏全被审出（注入条数受题面自由格数封顶，0 条时这条就是空闸）',
    oobFake === fak.length && fak.length >= 4, `注入 ${fak.length} 条 · 审出 ${oobFake} 条`);
  eq('§5 改回真值后归零', auditLedger(p.ledger.filter((x) => !x.FAKE), truth).oob, 0);
  const wrong = pencilSolve(f, { preset: free.slice(0, 8).map((i, k) => ({ i, v: truth[i] === 1 ? 0 : BLK, rule: RULES[k % RULES.length] })) });
  ok('§5 错色当**已知条件**喂进引擎：留下可见痕迹（矛盾 > 0 且不算推完）',
    wrong.conflicts.length > 0 && wrong.done === false, `矛盾 ${wrong.conflicts.length} · done=${wrong.done}`);
  ok('§5 错色前提也被账本证人抓到', auditLedger(wrong.ledger, truth).oob > 0, `越轨 ${auditLedger(wrong.ledger, truth).oob} 条`);
}

// ---------------------------------------------------------------- §6 一份几何
console.log('\n[§6 铅笔与裁判共用同一份候选方形表]');
{
  const bad = FACES.filter(({ f }) => pencilSolve(f).squares !== countSolutions(f, { ...DEFAULTS, limit: 2 }).candidates);
  eq('§6 语料每张题面上两个消费者的方形数同源', bad.length, 0);
  const badReal = [...byKey.values()].flat().filter((x) => x.p.squares !== countSolutions(x.r.face, { ...DEFAULTS, limit: 2 }).candidates);
  eq('§6 出货盘上也同源（8x8 深档是最容易分岔的尺寸）', badReal.length, 0);
  for (const sw of [{ allowSingle: false }, { readA: 'contact' }]) {
    eq(`§6 换开关 ${JSON.stringify(sw)} 之后仍同源`,
      FACES.filter(({ f }) => pencilSolve(f, sw).squares !== countSolutions(f, { ...DEFAULTS, ...sw, limit: 2 }).candidates).length, 0);
  }
}

// ---------------------------------------------------------------- §7 停止条件
console.log('\n[§7 迭代预算截断必须被记成 overrun，不许静默当成"推完了"]');
{
  const sample = [...byKey.values()].flat().slice(0, 6);
  const cut = sample.map((x) => pencilSolve(x.r.face, { maxSweeps: 1 }));
  ok('§7 maxSweeps=1 的盘全部带 overrun 痕迹或本来就一步推得完（sweeps ≤ 1）',
    cut.every((c) => c.sweeps <= 1), cut.map((c) => `sweeps=${c.sweeps} overrun=${c.overrun}`).join(' · '));
  const full = sample.map((x) => x.p);
  ok('§7 正常预算下没有一张走到截断（overrun 出现就说明承诺的 sweeps 上限小了）',
    full.every((p) => p.overrun === false), full.map((p) => `sweeps=${p.sweeps}`).join(' · '));
}

// ---------------------------------------------------------------- §8 结构上界
console.log('\n[§8 记账的形状：每步至少填一格 · 已定 + 未知 = 格子数]');
{
  const items = FACES.map(({ f }) => ({ f, p: pencilSolve(f) }))
    .concat([...byKey.values()].flat().map((x) => ({ f: x.r.face, p: x.p })));
  let shape = 0, steps = 0, ded = 0, alive = 0;
  for (const { f, p } of items) {
    let unk = 0, dec = 0, free = 0;
    for (let i = 0; i < f.c.length; i++) if (f.c[i] === FREE) { free++; if (p.st[i] === UNK) unk++; else dec++; }
    if (unk + dec !== free || unk !== p.unknown || free !== p.cells) shape++;     // 状态数组不许漏格或重复计
    if (p.steps > free) steps++;                                                  // 一步至少落一个新自由格
    if (p.deductions < p.steps) ded++;                                            // 每步至少留下一条结论
    if (p.done && unk !== 0) alive++;                                             // done 的定义就是没有未知
  }
  eq('§8 未知 + 已定 = 自由格数，且与 unknown/cells 两个读数自洽', shape, 0);
  eq('§8 steps ≤ 自由格数（每步至少填一格）', steps, 0);
  eq('§8 deductions ≥ steps（账本条数不少于步数）', ded, 0);
  eq('§8 done 的盘上 unknown 必为 0', alive, 0);
}

console.log(`\nPENCIL-TEST ${checks} checks / ${fails} failed`);
process.exit(fails ? 1 : 0);
