#!/usr/bin/env node
// 裁判闸 · countSolutions —— "这盘有几个解"的答案必须对得起一条独立的对照通道
//
// 存在理由：出货条件的第一半（唯一性认证）完全由 counter.js 说了算。如果它数错了，出题器
// 会把多解的盘当唯一解卖掉，而铅笔那边**看不出**来 —— 铅笔只说"我推不完"，它不知道还有
// 第二个解。所以这份计数必须由一条与搜索完全不同的通道对照：tools/lib-packing.mjs 枚举
// **候选方形的全部合法打包**（不重叠、不共边），每个涂黑交给规则模型 verify() 判读数，
// 两条通道逐张对撞个数与解集合。对照通道故意不用 limit、不用 MRV、不用任何剪枝。
//
// 跑法：  node tools/counter-test.mjs
//
// 每段都写了"什么改动会让这段红"：
//   §1 打包对撞      PHASE 1 的封口(seal)写错、'?' 被拉进子集和导致重复计数、PHASE 2 的
//                    "第一个开放格"分解不再唯一 —— 任何一条都会让两边数出不同个数。
//   §2 解的形状      wantSolutions 交回的涂黑过不了规则模型 / 同一个解被数两次 / 条数与
//                    count 不符 ⇒ 红。裁判与规则模型的互认是出货凭证的另一半。
//   §3 两版挑格序    mrv 与行序逐张对撞必须同 count。留两版是为了"便宜"不能是我自己挑格
//                    顺序的运气（Sashigane 上我确实被自己写坏的行序长尾骗过一次）。**但方向不是定理**：
//                    本题材两版成本只差几个节点，所以这里只断言"两版都对、都远在预算之内"。
//   §4 两条保险丝    节点闸必须叫 'node'；ms 闸每 256 个节点才查一次钟 ⇒ 短搜索上挂 msCap=0
//                    **不许**停（这就是"生产表里不放钟"那条决定的正面证据）。
//   §5 一份几何      裁判看到的候选方形数必须与 squareTable() 逐开关一致（三方共用一份几何）。
//   §6 读数诚实      stopped / limitReached / exact 三者的关系是定义，不是实现细节；
//                    stoppedBy 的词表只有 node|ms|null。
//   §7 负控          往裁判交回的解里翻一个格 ⇒ auditSolutions 必须抓出来；自相矛盾的题面
//                    必须数到 0 而不是崩或报 1；几何引理的下游证人 wrapDup 在全量语料上恒 0。

import {
  DEFAULTS, FREE, makeFace, faceRows, verify, squareTable,
} from '../js/engine/rules.js';
import { countSolutions, auditSolutions } from '../js/engine/counter.js';
import { growFace, DENSITY, TIERS, produce } from '../js/engine/generate.js';
import { makeRng, shuffled, hash32, seedOf } from '../js/engine/rng.js';
import { packingCount, packingBlacks } from './lib-packing.mjs';

console.log('================================================================================');
console.log('TASQUARE COUNTER-TEST — 裁判 vs 打包穷举 / 两条保险丝的名字 / 一份几何三个消费者');
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

/** 语料：4x4 / 3x4 的 grown 面（满线索）+ 随机删线索的版本（多解的温床），外加手搓的边角题面。
 *  尺寸被压在"独立通道能穷举"的量级里：5x5 只留两条线索的那张，全枚举 4.4 万个打包 ≈ 0.2 s。 */
function corpus() {
  const faces = [];
  for (let s = 0; s < 8; s++) {
    for (const [h, w] of [[4, 4], [3, 4]]) {
      const g = growFace(h, w, makeRng(`ct|${s}`), { ...DEFAULTS }, DENSITY);
      if (!g.ok) continue;
      faces.push({ name: `${h}x${w}#s${s} full`, f: g.face });
      const drop = shuffled([...g.face.c.keys()].filter((i) => g.face.c[i] !== FREE), makeRng(`ct|${s}|drop`));
      const f2 = makeFace(faceRows(g.face));
      for (const i of drop.slice(0, Math.max(1, Math.floor(drop.length / 2)))) f2.c[i] = FREE;
      faces.push({ name: `${h}x${w}#s${s} half`, f: f2 });
      const f3 = makeFace(faceRows(g.face));         // 只留四分之一条线索：多解的温床
      for (const i of drop.slice(0, Math.max(1, Math.floor(drop.length * 0.75)))) f3.c[i] = FREE;
      faces.push({ name: `${h}x${w}#s${s} quarter`, f: f3 });
    }
  }
  // 手搓边角：印 0 的线索、'?'、多位数、自相矛盾、只对角相接的两区
  faces.push({ name: 'hand zero', f: makeFace(['. . . .', '. . . .', '. 0 . .', '. . . .']) });
  faces.push({ name: 'hand q', f: makeFace(['. 1 . .', '. . . .', '? . . .', '. . . .']) });
  faces.push({ name: 'hand contra', f: makeFace(['. 99 .', '. . .', '. . .']) });
  faces.push({ name: 'hand big', f: makeFace(['. . 8 . .', '. . . . .', '. . . . .', '. . ? . .', '. . . . .']) });
  return faces;
}
const FACES = corpus();

// ---------------------------------------------------------------- §1 独立通道对撞
console.log(`\n[§1 裁判 vs 打包穷举（${FACES.length} 张题面 · 对照通道完全不看线索数值）]`);
{
  const mismatch = [], kinds = { zero: 0, one: 0, many: 0 };
  let examined = 0;
  for (const { name, f } of FACES) {
    const bf = packingCount(f, DEFAULTS);                 // 全枚举，不加 limit
    examined += bf.examined;
    kinds[bf.count === 0 ? 'zero' : bf.count === 1 ? 'one' : 'many']++;
    // limit 压在对照通道的读数**之上**：裁判的 count 到 limit 就停，所以想比"到底有几个"，
    // 就要给它一个比真解数更大的 limit（这条同时管住两种错：数多了、以及被 limit 截了当准数）。
    const r = countSolutions(f, { ...DEFAULTS, limit: bf.count + 1, nodeCap: 200_000 });
    if (r.count !== bf.count) mismatch.push(`${name} 打包 ${bf.count} vs 裁判 ${r.count}(nodes=${r.nodes})`);
    if (r.stopped === false && r.exact !== true) mismatch.push(`${name} 没撞预算却不 exact（limit=${bf.count + 1} > count=${r.count}）`);
    if (bf.count < 2) {                                   // 同一张题面改 limit=2：读数必须与"到底有几个"自洽
      const r2 = countSolutions(f, { ...DEFAULTS, limit: 2 });
      if (r2.count !== bf.count || r2.exact !== (bf.count < 2 && !r2.stopped)) mismatch.push(`${name} limit=2 给 ${r2.count}/exact=${r2.exact}`);
    }
  }
  ok('§1 每张题面上裁判的 count 都等于打包穷举的 count（封口/子集和/问号处理任何一处写歪都会红）',
    mismatch.length === 0, mismatch.join(' · ') || `对撞 ${FACES.length} 张 · 对照通道共走 ${examined} 个合法打包`);
  ok('§1 语料覆盖三种解数（0 个 / 恰好 1 个 / 多个）—— 只比唯一解等于没比对撞',
    kinds.zero > 0 && kinds.one > 0 && kinds.many > 0, JSON.stringify(kinds));
}

// ---------------------------------------------------------------- §2 解的形状
console.log('\n[§2 裁判交回的解：过规则模型 · 两两不同 · 条数与 count 相符]');
{
  let bad = 0, dup = 0, shape = 0, got = 0;
  for (const { f } of FACES) {
    const r = countSolutions(f, { ...DEFAULTS, limit: 4, wantSolutions: true, nodeCap: 200_000 });
    bad += auditSolutions(f, r, DEFAULTS);
    const seen = new Set(r.solutions.map((b) => b.join('')));
    if (seen.size !== r.solutions.length) dup++;
    for (const b of r.solutions) {
      got++;
      let blacks = 0;
      for (let i = 0; i < b.length; i++) { if (b[i]) blacks++; if (b[i] && f.c[i] !== FREE) shape++; }   // 解里不许有线索格被涂黑
      if (b.length !== f.h * f.w) shape++;
      if (blacks === b.length) shape++;                                                    // 全黑盘不可能合法（白格要连通）
    }
  }
  eq('§2 auditSolutions 对每一张交回的解都说"合法"', bad, 0);
  ok('§2 同一个解不会被数两次（PHASE 2 的分解唯一性）', dup === 0, `重复题面 ${dup} 个 · 取回 ${got} 张解`);
  eq('§2 交回的解里没有线索格被涂黑、长度自洽、不是全黑盘', shape, 0);
  // 两条通道的**解集合**（不只是个数）必须相同：个数相同、解不同是一种更阴的错。
  {
    const mismatch = [];
    let compared = 0;
    for (const { name, f } of FACES) {
      const all = packingBlacks(f, DEFAULTS);
      if (all.length > 4) continue;                          // 裁判的 wantSolutions 只留 4 张，超出无可比性
      compared++;
      const A = new Set(countSolutions(f, { ...DEFAULTS, limit: 4, wantSolutions: true }).solutions.map((b) => b.join(',')));
      const B = new Set(all.map((b) => b.join(',')));
      if ([...A].some((x) => !B.has(x)) || [...B].some((x) => !A.has(x))) mismatch.push(`${name} 解集合不等`);
    }
    ok('§2 裁判交回的解集合 == 打包通道的解集合（逐张比涂黑，不止比个数）',
      mismatch.length === 0 && compared >= 6, `${compared} 张可比 · ${mismatch.slice(0, 3).join(' · ')}`);
  }
  const one = FACES.find(({ f }) => countSolutions(f, { ...DEFAULTS, limit: 2 }).count === 1);
  const r1 = countSolutions(one.f, { ...DEFAULTS, limit: 2, wantSolutions: true });
  eq('§2 count=1 时 wantSolutions 恰交回一张', r1.solutions.length, 1);
  const r4 = countSolutions(one.f, { ...DEFAULTS, limit: 9, wantSolutions: true });
  eq('§2 换 limit 不改那张唯一解（同一串题面、同一份几何）', r4.solutions.map((x) => x.join('')).join('|'), r1.solutions.map((x) => x.join('')).join('|'));
}

// ---------------------------------------------------------------- §3 两版挑格序
console.log('\n[§3 MRV 序 vs 行序：只比"谁对"，成本只打印不断言方向]');
{
  let diff = 0, stopped = 0, stoppedRow = 0; const mn = [], rn = [];
  for (const { name, f } of FACES) {
    const A = countSolutions(f, { ...DEFAULTS, limit: 4, mrv: true, nodeCap: 200_000 });
    const B = countSolutions(f, { ...DEFAULTS, limit: 4, mrv: false, nodeCap: 200_000 });
    if (A.count !== B.count) { diff++; console.log(`      分歧 ${name}: MRV ${A.count} vs 行序 ${B.count}`); }
    if (A.stopped) stopped++;
    if (B.stopped) stoppedRow++;
    mn.push(A.nodes); rn.push(B.nodes);
  }
  eq('§3 两种挑格序在每张题面上数出同一个 count', diff, 0);
  ok('§3 两版都没撞预算（否则对撞的是"谁先停"而不是"谁对"）', stopped === 0 && stoppedRow === 0, `MRV 停 ${stopped} 张 · 行序停 ${stoppedRow} 张`);
  console.log(`      节点数：MRV med ${pct(mn, .5)} max${pct(mn, 1)} · 行序 med ${pct(rn, .5)} max${pct(rn, 1)}（合计 ${mn.reduce((a, b) => a + b, 0)} vs ${rn.reduce((a, b) => a + b, 0)}；本节只比"谁对"，不比谁快 —— 见下方出货盘那段的说明）`);

  // 语料全是小题面，两种挑格序在上面分不出高下 —— 真实出货盘（6x6/8x8）上再撞一遍。
  // 档位从 TIERS 取，不写死档名：加一档就自动进对撞，漏一档会红（这是本仓闸的旧伤）。
  const real = [], rmr = [], rro = [];
  for (const t of TIERS) for (let s = 0; s < 6; s++) {
    const p = produce(t.key, { rawSeed: `ctx|${t.key}|${s}` });
    if (!p.ok) continue;
    const A = countSolutions(p.face, { ...DEFAULTS, limit: 2, mrv: true, nodeCap: 200_000 });
    const B = countSolutions(p.face, { ...DEFAULTS, limit: 2, mrv: false, nodeCap: 200_000 });
    real.push({ key: t.key, s, f: p.face, truth: p.blacks, A, B });
    rmr.push(A.nodes); rro.push(B.nodes);
  }
  console.log(`      出货盘 ${real.length} 张（TIERS 全档）节点：MRV med ${pct(rmr, .5)} max${pct(rmr, 1)} · 行序 med ${pct(rro, .5)} max${pct(rro, 1)}`);
  ok('§3 每张出货盘两版挑格序都数出唯一解且没撞预算',
    real.length >= 12 && real.every(({ A, B }) => A.count === 1 && B.count === 1 && !A.stopped && !B.stopped),
    `${real.length} 张 · 分歧 ${real.filter(({ A, B }) => A.count !== B.count).length}`);
  const worst = Math.max(0, ...rmr, ...rro);
  ok('§3 两种挑格序的最坏出货盘都在各档预算的 50 倍余量以内（保险丝不是"选对了序"的运气）',
    TIERS.every((t) => worst * 50 <= t.ship.nodeCap), `最坏 ${worst} 节点 vs 预算 ${TIERS.map((t) => t.ship.nodeCap).join('/')}`);
  // 这里**不断言**谁更快。别的题材上我因为只留一版挑格序，差点被自己写坏的行序长尾骗去否掉
  // 整个品类；本题材两版的中位只差几个节点（成本由线索数封顶，尾巴本来就短）。把"MRV 更快"
  // 写成定理就是又一次拿口味当证据 —— 留着两版、只断言"两版数出的事相同且都便宜"。
  console.log(`      两种序的合计差 ${rmr.reduce((a, b) => a + b, 0) - rro.reduce((a, b) => a + b, 0)} 节点（无方向断言）`);
  {
    // 出货凭证上的 blacks 是**重新数一遍的计数器解**回填的（generate.js 刻意不信自己铺的几何）。
    // 这里再数第三遍并逐格比 —— 比的是那条回填链条，不是出题器自记的账。
    let diff = 0;
    for (const { f, truth } of real) {
      const r = countSolutions(f, { ...DEFAULTS, limit: 2, wantSolutions: true, nodeCap: 200_000 });
      if (r.solutions.length !== 1) { diff++; continue; }
      for (let i = 0; i < truth.length; i++) if ((r.solutions[0][i] === 1) !== (truth[i] === 1)) { diff++; break; }
    }
    eq('§3 裁判交回的唯一解逐格等于出货凭证上那张 blacks', diff, 0);
  }
}

// ---------------------------------------------------------------- §4 两条保险丝
console.log('\n[§4 两条保险丝各自的名字 · ms 闸的 256 节点节拍]');
{
  // 想测保险丝，必须让搜索**没有别的理由**停：limit 压到无穷大，停下来的唯一原因就是预算/钟。
  const wide = makeFace(['. . . . . .', '. . . . . .', '. . . . . .', '. . . . . .', '. . . . . .', '. . . . . .']);
  const N = countSolutions(wide, { ...DEFAULTS, limit: 1e9, nodeCap: 90 });
  ok('§4 节点闸打断长搜索并署名 node', N.stopped === true && N.stoppedBy === 'node' && N.exact === false, `nodes=${N.nodes} stoppedBy=${N.stoppedBy} count=${N.count}`);
  const M = countSolutions(wide, { ...DEFAULTS, limit: 1e9, nodeCap: 1e9, msCap: 0 });
  ok('§4 超过 256 节点的搜索会被 ms 闸打断并署名 ms（msCap=0 是最狠的钟）',
    M.stopped === true && M.stoppedBy === 'ms' && M.nodes >= 256, `nodes=${M.nodes} stoppedBy=${M.stoppedBy}`);
  const tight = makeFace(['. . .', '2 . .', '. . ?']);
  const S = countSolutions(tight, { ...DEFAULTS, limit: 1e9, nodeCap: 1e9, msCap: 0 });
  ok('§4 短搜索（<256 节点）在 msCap=0 上也不许停 —— 节拍没查到钟，这就是"探针上挂钟打不出击穿"的正面证据',
    S.stopped === false && S.nodes < 256, `nodes=${S.nodes} stoppedBy=${String(S.stoppedBy)}`);
  ok('§4 stoppedBy 的词表只有 node|ms|null（红必须点名它的闸，不能有第二种说法）',
    [N, M, S].every((x) => ['node', 'ms', null].includes(x.stoppedBy)), [N, M, S].map((x) => String(x.stoppedBy)).join(','));
  const zero = countSolutions(wide, { ...DEFAULTS, limit: 2, nodeCap: 0 });
  ok('§4 nodeCap 极小 ⇒ 一次都不许声称数完', zero.stopped === true && zero.exact === false && zero.stoppedBy === 'node', `nodes=${zero.nodes} count=${zero.count}`);
}

// ---------------------------------------------------------------- §5 一份几何三个消费者
console.log('\n[§5 裁判看到的候选方形数 == squareTable() 逐开关一致]');
{
  for (const sw of [{}, { allowSingle: false }, { readA: 'contact' }]) {
    const o = { ...DEFAULTS, ...sw };
    const bad = FACES.filter(({ f }) => countSolutions(f, { ...o, limit: 2 }).candidates !== squareTable(f, o).squares.length).length;
    eq(`§5 candidates 与 squareTable 同表（${JSON.stringify(sw)}）`, bad, 0);
  }
  const area = FACES.map(({ f }) => countSolutions(f, { ...DEFAULTS, limit: 4 }).count).join(',');
  const contact = FACES.map(({ f }) => countSolutions(f, { ...DEFAULTS, readA: 'contact', limit: 4 }).count).join(',');
  ok('§5 换读法（contact）会改答案 ⇒ readA 是题面语义而不是显示选项', area !== contact, `area ${area.slice(0, 40)}… vs contact ${contact.slice(0, 40)}…`);
}

// ---------------------------------------------------------------- §6 读数的诚实性
console.log('\n[§6 exact / limitReached / stopped 的定义关系]');
{
  let wrong = [];
  for (const cfg of [{ limit: 1 }, { limit: 2 }, { limit: 4, nodeCap: 30 }, { limit: 4 }]) {
    for (const { name, f } of FACES) {
      const r = countSolutions(f, { ...DEFAULTS, ...cfg });
      const wantExact = !r.stopped && r.count < (cfg.limit ?? 2);
      if (r.exact !== wantExact) wrong.push(`${name}/${JSON.stringify(cfg)} exact=${r.exact} 应为 ${wantExact}`);
      if (r.limitReached !== (r.count >= (cfg.limit ?? 2))) wrong.push(`${name}/${JSON.stringify(cfg)} limitReached=${r.limitReached}`);
      if (r.stopped && r.exact) wrong.push(`${name} stopped 却 exact`);
    }
  }
  ok('§6 exact 只在"没停且没到 limit"时为真（撞预算/撞钟就不是一个读数）', wrong.length === 0, wrong.slice(0, 3).join(' · '));
  const det = FACES.slice(0, 6).every(({ f }) => {
    const a = countSolutions(f, { ...DEFAULTS, limit: 4 }), b = countSolutions(f, { ...DEFAULTS, limit: 4 });
    return a.count === b.count && a.nodes === b.nodes && a.leaves === b.leaves && a.assignments === b.assignments && a.wrapDup === b.wrapDup;
  });
  ok('§6 同一张题面重跑逐字段一致（裁判里不许有隐藏的随机性）', det, 'count/nodes/leaves/assignments/wrapDup 五项');
}

// ---------------------------------------------------------------- §7 负控与引理证人
console.log('\n[§7 负控：证人必须能被伪造骗出反应；wrapDup 全量恒 0]');
{
  const withSol = FACES.find(({ f }) => countSolutions(f, { ...DEFAULTS, limit: 2, wantSolutions: true }).solutions.length === 1);
  const r = countSolutions(withSol.f, { ...DEFAULTS, limit: 2, wantSolutions: true });
  eq('§7 真解不被 auditSolutions 挑刺', auditSolutions(withSol.f, r, DEFAULTS), 0);
  const fake = { solutions: r.solutions.map((b) => { const c = b.slice(); for (let i = 0; i < c.length; i++) if (withSol.f.c[i] === FREE) { c[i] ^= 1; break; } return c; }) };
  ok('§7 每张交回的解翻一个自由格 ⇒ auditSolutions 一条不漏地抓出', auditSolutions(withSol.f, fake, DEFAULTS) === fake.solutions.length,
    `抓到 ${auditSolutions(withSol.f, fake, DEFAULTS)}/${fake.solutions.length}`);
  const contra = makeFace(['. 99 . .', '. . . .', '. . . .', '. . . .']);
  const C = countSolutions(contra, { ...DEFAULTS, limit: 2, nodeCap: 200_000 });
  ok('§7 印一个够不到的读数 ⇒ 数到 0 且 exact（不许崩、不许报 1）', C.count === 0 && C.exact === true, `count=${C.count} exact=${C.exact} nodes=${C.nodes}`);
  const wd = FACES.reduce((a, { f }) => a + countSolutions(f, { ...DEFAULTS, limit: 4, wantSolutions: true }).wrapDup, 0);
  eq('§7 几何引理的下游证人：全量语料 wrapDup 恒 0（一个区碰一条线索至多一条边）', wd, 0);
  ok('§7 wrap 读法与 area 读法数出同一批解（引理的推论，两条通道各算一遍）',
    FACES.every(({ f }) => countSolutions(f, { ...DEFAULTS, readA: 'wrap', limit: 4 }).count === countSolutions(f, { ...DEFAULTS, readA: 'area', limit: 4 }).count),
    'readA=wrap ≡ area');
  // 裁判不吃随机数：seedOf/hash32 只属于出题路径，这里换 seed 不改裁判读数
  const f0 = FACES[0].f;
  eq('§7 裁判与 seed 无关（同一张题面两次调用同读数）', countSolutions(f0, { ...DEFAULTS, limit: 2 }).nodes, countSolutions(f0, { ...DEFAULTS, limit: 2 }).nodes);
  ok('§7 seedOf 仍拒绝不合规档位串（rng 的入口校验只有一份）', (() => { try { seedOf('bad key', 1); return false; } catch { return true; } })(), 'seedOf("bad key") 必须抛');
  ok('§7 hash32 对同一串稳定（裁判/铅笔都不碰它，出题器只碰它一次）', hash32('tasquare|irr-8x8|7') === hash32('tasquare|irr-8x8|7') && hash32('a') !== hash32('b'), '');
}

console.log(`\nCOUNTER-TEST ${checks} checks / ${fails} failed  (语料 ${FACES.length} 张题面)`);
process.exit(fails ? 1 : 0);
