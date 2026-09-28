#!/usr/bin/env node
// 档位定价与承诺闸 · Tasquare
//
// 跑法：  node tools/balance.mjs                  （默认 SAMPLES=20/档）
//        SAMPLES=60 node tools/balance.mjs        （重跑 tasquare| 那一批定价读数）
//        SAMPLES=60 SEED_PREFIX=price node tools/balance.mjs   （另一批：price| 独立随机数）
//        SAMPLES=24 node tools/balance.mjs        （CI 用的量）
//        TIERS 注释里的每个数字都出自这两批 n=60 之一，两条命令都在仓里，谁都能原地复跑。
//
// 这个文件存在的理由只有一句话：**TIERS 里的每个数字都必须是被量出来的，而不是被想到的**。
// 所以它按节干这些事：
//   A 结构不变量   —— 生产路径上不许出现墙钟（seed→盘 必须与机器速度无关，一条定理而不是观察）
//   B 逐档实测量   —— 出货率 / 线索数分布 / 铅笔步数分布 / 探针次数 / 证书节点 / 记账恒等式，
//                     并且**每一张出货盘都用三条独立通道现复核一遍**（整盘 verify、裁判重数、
//                     铅笔重推），不信任 produceBoard 自己的返回值 —— 出题器记的账会说谎
//                     （Yajilin 烧过：裁完线索之后 board.black 不再是任何解）。
//   C 同尺寸对照   —— 难度轴是线索数而不是格子数，所以同尺寸的相邻两档步数分布必须分得开
//   D/E 负控与证人 —— "故意掐预算"的负控必须真的打出对应反应；不可约档的每条幸存线索必须
//                     **现删现数**都被证明删不掉（F 节），band 收窄一档要被现样本推翻（E4）。
//                     D 还钉住**随机流本身**的金标准（u32 序列 / 洗牌序 / hash32 三个定值）：
//                     同 seed 的两次调用互比抓不到 PRNG 被改 —— 两侧会一起漂，只有定值能。
//   G 语义旋钮     —— printZero / allowSingle / readA 参与判定的证据（换掉它们是换游戏）
//   H 饱和点       —— 同 seed 配对只换 target，证明"裁到 4 条"是一个不存在的旋钮
//
// 红必须点名它的闸：每条 ok/FAIL 都带实测读数，失败原因若落在 'pencil' 之外（尤其是
// 'ship-stopped' / 'truth' / 'draws'）就是承诺破口，不是"这台机器慢"。
//
// 分布一律打印 min/p5/med/p95/max：聚合数（"出货率 80%"）会被少数退化样本抬起来，
// 单看它等于没看。

import {
  TIERS, produce, produceBoard, tierOf, clueCount, growFace, DENSITY,
} from '../js/engine/generate.js';
import { DEFAULTS, FREE, faceTokens, verify, cloneFace } from '../js/engine/rules.js';
import { countSolutions } from '../js/engine/counter.js';
import { pencilSolve, BLK } from '../js/engine/pencil.js';
import { makeRng, shuffled, hash32 } from '../js/engine/rng.js';

const SAMPLES = Math.max(4, Number(process.env.SAMPLES ?? 20));
// 档位定价要靠**两批**独立随机数，而不是把同一批跑两遍：SEED_PREFIX 换的只是 seed 串的前缀
// （局号来源串），判定路径一字不动。默认前缀 = 生产口径（rng.js 的 tasquare|<档>|<局号>）。
const PREFIX = process.env.SEED_PREFIX || 'tasquare';
const seedFor = (key, s) => (PREFIX === 'tasquare' ? s : { rawSeed: `${PREFIX}|${key}|${s}` });
const pct = (xs, p) => { const s = xs.slice().sort((a, b) => a - b); return s.length ? s[Math.min(s.length - 1, Math.floor(p * (s.length - 1)))] : NaN; };
const dist = (xs) => (xs.length ? `min${pct(xs, 0)} p5 ${pct(xs, .05)} med ${pct(xs, .5)} p95 ${pct(xs, .95)} max${pct(xs, 1)}` : '（空样本）');

console.log('================================================================================');
console.log('TASQUARE BALANCE — 档位定价与承诺');
console.log(`node ${process.version} · SAMPLES=${SAMPLES}/档 · seed=${PREFIX}|<档>|<局号> · readA=${DEFAULTS.readA} allowSingle=${DEFAULTS.allowSingle} printZero=${DEFAULTS.printZero}`);
console.log('================================================================================');

let checks = 0, fails = 0;
const ok = (gate, cond, detail = '') => {
  checks++;
  if (!cond) fails++;
  console.log(`  ${cond ? 'ok  ' : 'FAIL'} ${gate} :: ${detail}`);
};

// ---------------------------------------------------------------- A 结构不变量
console.log('\n[A 档位表的结构不变量]');
{
  ok('A 每档 key 唯一且可进 seed 串', new Set(TIERS.map((t) => t.key)).size === TIERS.length && TIERS.every((t) => tierOf(t.key) === t), TIERS.map((t) => t.key).join(', '));
  ok('A 每档 band/steps 是 [下界,上界] 且下界>0', TIERS.every((t) => t.band[0] <= t.band[1] && t.steps[0] <= t.steps[1] && t.band[0] > 0), TIERS.map((t) => `${t.key}:${t.band}`).join(' '));
  ok('A 每档 yieldFloor 在 (0,1]', TIERS.every((t) => t.yieldFloor > 0 && t.yieldFloor <= 1), TIERS.map((t) => `${t.key}=${t.yieldFloor}`).join(' '));
  // 这一条是整张表的**可复现性地基**：一旦有人把钟放回判定路径，seed→盘 就随机器速度漂。
  ok('A 生产路径不含墙钟判定（ship/carve 的 msCap 都是 Infinity）',
    TIERS.every((t) => t.ship.msCap === Infinity && t.carve.msCap === Infinity),
    TIERS.map((t) => `${t.key} ship=${t.ship.msCap} carve=${t.carve.msCap}`).join(' '));
  const uniq = TIERS.filter((t) => t.target === 0).map((t) => t.key);
  ok('A 存在"裁到不可约"的档（深档语义只能是它，见文件头饱和点）', uniq.length >= 1, uniq.join(', '));
}

// ---------------------------------------------------------------- B 逐档实测量
const measured = new Map();
for (const t of TIERS) {
  console.log(`\n[B ${t.label}]  target=${t.target} band=${t.band} steps≤${t.steps[1]} maxDraws=${t.maxDraws} yieldFloor=${t.yieldFloor}`);
  const shipped = [], failReason = {}, ms = [];
  const A = { clues: [], steps: [], sweeps: [], probes: [], draws: [], nodes: [], kept: [], removed: [], necessary: [], layTried: [], certRejected: [] };
  for (let s = 0; s < SAMPLES; s++) {
    const t0 = performance.now();
    const r = produce(t.key, seedFor(t.key, s));
    ms.push(performance.now() - t0);
    if (!r.ok) { failReason[r.fail] = (failReason[r.fail] || 0) + 1; continue; }
    shipped.push(r);
    const rc = r.receipt;
    A.clues.push(r.clues); A.steps.push(rc.pencilSteps); A.sweeps.push(rc.pencilSweeps);
    A.probes.push(rc.probes); A.draws.push(rc.draws); A.nodes.push(rc.shipNodes);
    A.kept.push(rc.keptByBudget); A.removed.push(rc.removed); A.necessary.push(rc.necessary);
    A.layTried.push(rc.layTried); A.certRejected.push(rc.certRejected);
  }
  measured.set(t.key, { shipped, A, ms, failReason });
  const rate = shipped.length / SAMPLES;
  console.log(`      出货 ${shipped.length}/${SAMPLES}（${(rate * 100).toFixed(0)}%）· 失败原因 ${JSON.stringify(failReason)}`);
  console.log(`      clues ${dist(A.clues)} | steps ${dist(A.steps)} | sweeps med ${pct(A.sweeps, .5)}`);
  console.log(`      探针 ${dist(A.probes)} | 裁掉 ${dist(A.removed)} | 必需 ${dist(A.necessary)} | 击穿 ${dist(A.kept)}`);
  console.log(`      draws ${dist(A.draws)} | grown 面铺成 ${dist(A.layTried)} 次/盘、多解被拒 ${dist(A.certRejected)} 次/盘`);
  console.log(`      证书节点 ${dist(A.nodes)} | 整盘 ms ${dist(ms.map((x) => +x.toFixed(2)))} max ${Math.max(...ms, 0).toFixed(1)}`);

  ok(`B ${t.key} 出货率 >= yieldFloor`, rate >= t.yieldFloor, `${(rate * 100).toFixed(0)}% vs 下界 ${(t.yieldFloor * 100).toFixed(0)}%`);
  ok(`B ${t.key} 失败原因只有 pencil（不许出现 ship-stopped/truth/draws/cert）`,
    Object.keys(failReason).every((k) => k === 'pencil'), JSON.stringify(failReason));
  ok(`B ${t.key} 出货线索数全部落在承诺区间`, A.clues.every((c) => c >= t.band[0] && c <= t.band[1]), `${dist(A.clues)} vs ${t.band}`);
  ok(`B ${t.key} 铅笔步数全部落在承诺区间`, A.steps.every((c) => c >= t.steps[0] && c <= t.steps[1]), `${dist(A.steps)} vs ${t.steps}`);
  ok(`B ${t.key} 探针击穿 0（生产档没有钟，就不该有"因预算而留的线索"）`, A.kept.every((k) => k === 0), dist(A.kept));
  // 预算余量：拿**这一批实测的最坏调用**定价，而不是拿上一次跑批的数字（换机器、换 seed 都会漂）
  ok(`B ${t.key} 节点预算对实测最坏证书调用有 >=50x 余量`,
    A.nodes.length && Math.max(...A.nodes) * 50 <= t.ship.nodeCap, `实测 max ${A.nodes.length ? Math.max(...A.nodes) : '-'} vs 预算 ${t.ship.nodeCap}`);
  ok(`B ${t.key} 记账恒等式 探针==裁掉+必需+击穿`, shipped.every((r) => r.receipt.probes === r.receipt.removed + r.receipt.necessary + r.receipt.keptByBudget),
    shipped.slice(0, 4).map((r) => `${r.receipt.probes}=${r.receipt.removed}+${r.receipt.necessary}+${r.receipt.keptByBudget}`).join(' '));
  ok(`B ${t.key} 记账恒等式 removed+clues==cluesBefore`, shipped.every((r) => r.receipt.removed + r.clues === r.receipt.cluesBefore),
    shipped.slice(0, 4).map((r) => `${r.receipt.removed}+${r.clues}==${r.receipt.cluesBefore}`).join(' '));
  if (t.target === 0) {
    ok(`B ${t.key} 不可约档：necessary+击穿 == 幸存线索数`, shipped.every((r) => r.receipt.necessary + r.receipt.keptByBudget === r.clues),
      shipped.slice(0, 4).map((r) => `${r.receipt.necessary}+${r.receipt.keptByBudget}==${r.clues}`).join(' '));
  } else {
    // 没裁到 target 只有一个合法理由：把每条线索都试过了。否则就是 carve 提前收工还自称这一档。
    ok(`B ${t.key} 未达 target 的盘必须已试完全部线索`, shipped.every((r) => r.clues <= t.target || r.receipt.probes === r.receipt.cluesBefore),
      shipped.slice(0, 5).map((r) => `clues=${r.clues}/target=${t.target} probes=${r.receipt.probes} cluesBefore=${r.receipt.cluesBefore}`).join(' '));
  }
  // 独立复核：不信任 produceBoard 交回来的 blacks/receipt，三条通道各走一遍
  let bad = [];
  for (const r of shipped) {
    if (clueCount(r.face) !== r.clues) bad.push(`receipt.clues 与题面数不上 ${r.seed} ${r.clues} vs ${clueCount(r.face)}`);
    if (verify(r.face, r.blacks, DEFAULTS).length) bad.push(`整盘不合法 ${r.seed}`);
    const c = countSolutions(r.face, { ...DEFAULTS, limit: 2, nodeCap: 200_000, wantSolutions: true });
    if (c.stopped || c.count !== 1) bad.push(`重数!=唯一 ${r.seed} count=${c.count} stopped=${c.stopped} by=${c.stoppedBy}`);
    const p = pencilSolve(r.face, DEFAULTS);
    if (!p.done || p.legalIfDone !== 0) bad.push(`铅笔推不完 ${r.seed} unknown=${p.unknown}`);
    else { let d = 0; for (let i = 0; i < r.blacks.length; i++) if ((p.st[i] === BLK) !== (r.blacks[i] === 1)) d++; if (d) bad.push(`铅笔解!=出货解 ${r.seed} 差${d}格`); }
  }
  ok(`B ${t.key} 每张出货盘都被三条独立通道现复核过`, bad.length === 0, bad.slice(0, 4).join(' | ') || `${shipped.length} 张全过`);
}

// ---------------------------------------------------------------- C 难度轴
// 这一节卖的是本品类**唯一**的难度主张：同一尺寸上，线索越少 ⇒ 铅笔要走的步越多。
// 数字来自 B 已经量到的样本，不额外跑批。
console.log('\n[C 难度轴：同一尺寸、只差目标线索数]');
{
  const bySize = new Map();
  for (const t of TIERS) {
    const m = measured.get(t.key);
    if (!m || !m.A.steps.length) continue;
    const k = `${t.h}x${t.w}`;
    if (!bySize.has(k)) bySize.set(k, []);
    bySize.get(k).push({ key: t.key, clues: pct(m.A.clues, .5), steps: pct(m.A.steps, .5), max: pct(m.A.steps, 1), yield: m.shipped.length / SAMPLES });
  }
  for (const [k, rows] of bySize) {
    rows.sort((a, b) => b.clues - a.clues);
    console.log(`      ${k}: ${rows.map((r) => `${r.key} clues med=${r.clues} steps med=${r.steps}(${r.max}) 出货率${(r.yield * 100).toFixed(0)}%`).join('  |  ')}`);
    for (let i = 1; i < rows.length; i++) {
      ok(`C ${k} 线索更少的档步数不减（难度轴方向）`,
        rows[i].clues < rows[i - 1].clues ? rows[i].steps >= rows[i - 1].steps : true,
        `${rows[i].key}(${rows[i].clues}条, med ${rows[i].steps}步) vs ${rows[i - 1].key}(${rows[i - 1].clues}条, med ${rows[i - 1].steps}步)`);
    }
  }
}

// ---------------------------------------------------------------- D 确定性与对账
console.log('\n[D 一张 seed 串一张盘（跨调用、跨"时钟"）]');
{
  // 失败也要能被比较：同一串 seed 今天失败、明天出货，同样是"seed 决定盘"这条定理的破口。
  const toks = (r) => (r.ok ? faceTokens(r.face).map((row) => row.join(' ')).join('|') : `失败:${r.fail}`);
  let same = 0, n = 0;
  for (const t of TIERS) for (const s of [0, 1, 5]) {
    n++;
    if (toks(produce(t.key, seedFor(t.key, s))) === toks(produce(t.key, seedFor(t.key, s)))) same++;
  }
  ok('D 同 seed 同档 ⇒ 逐字节同一张盘', same === n, `${same}/${n}`);
  let distinct = true; const seen = new Set(); const dup = [];
  for (const t of TIERS) for (const s of [0, 1, 2, 3]) {
    const r = produce(t.key, seedFor(t.key, s));
    if (!r.ok) continue;
    const k = toks(r);
    if (seen.has(k)) { distinct = false; dup.push(`${t.key}#${s}`); }
    seen.add(k);
  }
  ok('D 不同 seed ⇒ 不同盘（防止 seed 被静默忽略）', distinct && seen.size >= 8, `${seen.size} 张互不相同${dup.length ? ' · 重复 ' + dup.join(',') : ''}`);
  // 未知档位必须抛，不许悄悄回落到某一档
  ok('D 未知档位必须抛', (() => { try { produce('nope', 1); return false; } catch { return true; } })(), 'produce("nope") 没有返回盘也没被当成默认档');
  // 上面两条比的都还是**同一次运行里的两次调用**：谁改了 PRNG，两侧会一起漂，两条照样绿，
  // 而 TIERS 里每一批实测读数就此失去解释（同一串 seed 不再是同一张盘）。这一条把随机流本身
  // 钉成金标准 —— 它是"改 PRNG 必须红"的那道门，不是对某个特定机器的观察。
  const GOLD_U32 = [227477879, 4161101219, 2136465644, 834498531, 2923666948];   // makeRng('golden|tasquare') 前 5 个
  const g = makeRng('golden|tasquare');
  const gotU32 = GOLD_U32.map(() => (g() * 4294967296) >>> 0).join(',');
  ok('D 随机流金标准：同一串 seed 的前 5 个 u32 逐位不变', gotU32 === GOLD_U32.join(','), `期望 ${GOLD_U32.join(',')} · 实得 ${gotU32}`);
  const gotShuf = shuffled([...Array(10).keys()], makeRng('golden|tasquare')).join('');
  ok('D 洗牌金标准：比较器不吃随机数 ⇒ 同一串 seed 下 0..9 的序是定值（抽完再排，跨引擎同序）',
    gotShuf === '6792541380', `期望 6792541380 · 实得 ${gotShuf}`);
  const gotH = [hash32(''), hash32('golden|tasquare'), hash32('tasquare|easy-6x6|0')].join(',');
  ok('D hash32 金标准：FNV 偏移量与质数不可改', gotH === '2166136261,942340376,1189925988',
    `期望 2166136261,942340376,1189925988 · 实得 ${gotH}`);
}

// ---------------------------------------------------------------- E 负控
console.log('\n[E 负控：预算被掐住时，引擎必须**换一种回答**而不是换个答案]');
{
  const t = TIERS.find((x) => x.target === 0) || TIERS[TIERS.length - 1];
  const base = () => produceBoard(t.h, t.w, makeRng(`neg|${t.key}`), { sw: { ...DEFAULTS }, target: t.target, ship: t.ship, probe: t.carve, maxDraws: t.maxDraws });
  const ref = base();
  ok('E 参照：这一档正常能出货', ref.ok === true, `fail=${ref.fail || '-'} clues=${ref.ok ? ref.clues : '-'}`);

  // E1 探针**撞节点** ⇒ 唯一允许的副作用是"多留一条线索"，出货本身不许被掐断。
  //   两侧共用同一串 seed（seedFor 保证两边走同一条随机流）：几何与裁序的随机数都在撞预算
  //   **之前**抽完，所以撞上预算的那次生产画的是**同一块几何**，clues 之差才是纯判定效应
  //   而不是换了一张盘。
  //   为什么这里掐节点而不是钟：counter.js 每 256 个节点才查一次钟，而本品类 carve 探针的搜索
  //   规模实测 <256 节点 —— 也就是说探针上挂钟**根本打不出击穿**（我试过 msCap=0.0005：0/6 对
  //   触发）。"生产表里没有钟"因此没有拿掉任何保护，只是把一条本来就够不着的闸移出判定路径。
  let pressed = 0, pairs = 0; const cluePairs = [];
  for (let s = 0; s < 8; s++) {
    const plain = produce(t.key, seedFor(t.key, s));
    const slow = produce(t.key, seedFor(t.key, s), { probe: { nodeCap: 40, msCap: Infinity } });
    if (!plain.ok || !slow.ok) continue;
    pairs++;
    cluePairs.push([plain.clues, slow.clues]);
    if (slow.receipt.keptByBudget > 0) pressed++;
  }
  ok('E1 探针撞预算 ⇒ 击穿计数>0（预算闸确实接在"这条线索删不删"的入口上）', pressed > 0,
    `${pressed}/${pairs} 对里出现击穿；线索数对 ${cluePairs.slice(0, 5).map(([a, b]) => `${a}->${b}`).join(' ')}`);
  ok('E1 击穿只许让线索**变多**（方向安全：宁可多印一条，绝不漏证）', pairs >= 5 && cluePairs.every(([a, b]) => b >= a),
    cluePairs.map(([a, b]) => `${a}->${b}`).join(' ') || '没有成对样本');
  ok('E1 撞预算不掐断出货（被击穿的线索留下，盘仍然过闸）', pairs >= 5, `${pairs}/8 对双双出货`);

  // E2 出货证书撞预算 ⇒ 一张都不许交出去，而且**归因要留在账上**
  const tightNode = produceBoard(t.h, t.w, makeRng('e2'), { sw: { ...DEFAULTS }, target: t.target, ship: { nodeCap: 1, msCap: Infinity }, probe: t.carve, maxDraws: 20 });
  ok('E2 证书撞节点 ⇒ 不出货、烧完重抽额度、且 certStopped 记在账上',
    tightNode.ok === false && tightNode.fail === 'draws' && tightNode.receipt.certStopped > 0 && !tightNode.blacks,
    `ok=${tightNode.ok} fail=${tightNode.fail} certStopped=${tightNode.receipt.certStopped} certTried=${tightNode.receipt.certTried} 带 blacks=${!!tightNode.blacks}`);
  // 撞预算的重抽与"grown 面本来就多解"的重抽必须是**两笔账**：合并成一个数字就分不清
  // "这题的盘天生不唯一"和"我的预算不够"，而这两件事的修法完全相反。
  const loose = produceBoard(t.h, t.w, makeRng('e2b'), { sw: { ...DEFAULTS }, target: t.target, ship: { nodeCap: 200_000, msCap: Infinity }, probe: t.carve, maxDraws: 20 });
  ok('E2 正常预算下 certStopped==0（多解被拒的那笔账不许混进击穿）',
    loose.receipt.certStopped === 0 && loose.receipt.certRejected + loose.receipt.certStopped <= loose.receipt.certTried,
    `certTried=${loose.receipt.certTried} 多解拒=${loose.receipt.certRejected} 撞预算=${loose.receipt.certStopped}`);

  // E4 假承诺：把 band 收到不可能的区间，同一批盘必须被这条断言抓红 —— 证明 B 的区间不是装饰
  {
    const fake = { ...t, band: [0, 1] };
    const m = measured.get(t.key);
    const violated = m.shipped.some((r) => r.clues < fake.band[0] || r.clues > fake.band[1]);
    ok('E4 承诺区间真的有牙齿（把 band 收到 [0,1] 会被现样本推翻）', violated, `${t.key} 实测 clues ${dist(m.A.clues)}`);
  }
}

// ---------------------------------------------------------------- F 不可约证人
console.log('\n[F 不可约档：每条幸存线索都**现删现数**证明删不掉]');
{
  const t = TIERS.find((x) => x.target === 0);
  if (!t) { ok('F 存在不可约档', false, 'TIERS 里没有 target=0 的档'); }
  else {
    const picked = measured.get(t.key).shipped.slice(0, Math.min(5, measured.get(t.key).shipped.length));
    let fakeRedundant = 0, checked = 0;
    for (const r of picked) {
      for (let i = 0; i < r.face.c.length; i++) {
        if (r.face.c[i] === FREE) continue;
        const g = cloneFace(r.face); g.c[i] = FREE;
        const c = countSolutions(g, { ...DEFAULTS, limit: 2, nodeCap: 200_000 });
        checked++;
        if (!c.stopped && c.count === 1) { fakeRedundant++; console.log(`      多余的幸存线索 ${r.seed} @格${i}`); }
      }
    }
    ok('F 删掉任何一条线索都不再唯一（不可约性不是记账记出来的）', fakeRedundant === 0, `${checked} 次现删现数，多余 ${fakeRedundant} 条 · 档 ${t.key}`);
  }
}

// ---------------------------------------------------------------- G 语义开关
console.log('\n[G 三条 load-bearing 语义：换掉它们是**换游戏**，不是调难度]');
{
  const one = (sw) => {
    let u = 0, tried = 0;
    for (let s = 0; s < 12; s++) {
      const g = growFace(6, 6, makeRng('knob|' + s), sw, DENSITY);
      if (!g.ok) continue;
      tried++;
      const c = countSolutions(g.face, { ...DEFAULTS, ...sw, limit: 2, nodeCap: 200_000 });
      if (!c.stopped && c.count === 1) u++;
    }
    return { u, tried };
  };
  const on = one({}), off = one({ printZero: false }), noSingle = one({ allowSingle: false }), contact = one({ readA: 'contact' });
  console.log(`      grown 面唯一率：默认 ${on.u}/${on.tried} · 禁印 0 ${off.u}/${off.tried} · B=off ${noSingle.u}/${noSingle.tried} · contact 读法 ${contact.u}/${contact.tried}`);
  ok('G 禁印 0 会改变产量（所以 printZero 必须在页面上披露，不能被当成"整洁设置"关掉）',
    off.u < on.u, `默认 ${on.u} vs 禁 0 ${off.u}`);
  // readA 参与判定必须**量**出来，而不是靠"两条不同的 seed 串画了两张不同的盘"蒙过去
  // （我第一版就是这么写的：两侧 seed 串不同，那条断言其实什么都没说）。现在两侧同一串 seed，
  // 只换读法，数"两边都出货且题面不同"的对数；单侧出货也算 readA 改了判定。
  let both = 0, diff = 0, onlyOne = 0;
  for (let s = 0; s < 12; s++) {
    const a = produce(TIERS[0].key, seedFor(TIERS[0].key, s));
    const b = produce(TIERS[0].key, seedFor(TIERS[0].key, s), { sw: { ...DEFAULTS, readA: 'contact' } });
    if (a.ok !== b.ok) { onlyOne++; continue; }
    if (!a.ok) continue;
    both++;
    if (faceTokens(a.face).join('|') !== faceTokens(b.face).join('|')) diff++;
  }
  console.log(`      同一串 seed 只换 readA：两侧都出货 ${both} 对 · 题面不同 ${diff} 对 · 只有一侧出货 ${onlyOne} 对`);
  ok('G 换读法（contact）会换一批盘：同 seed 下题面或出货集合必须变（readA 在判定路径上 ⇒ 必须披露）',
    diff > 0 || onlyOne > 0, `${both} 对同出货/${diff} 对题面不同/${onlyOne} 对单侧出货`);
}

// ---------------------------------------------------------------- H 饱和点
// TIERS 把两个深档命名成"不可约"（target 0）而不是"裁到 4 条"，理由是量出来的：**target 掉到
// 饱和点以下之后，出货盘的线索数不再跟着 target 走**。做法是同一串 seed 配对 —— 几何与裁序都
// 由 seed 钉死，两侧唯一的变量就是停止规则，所以"要 0 条"与"要 4 条"若出货同一张盘，那个 4
// 就是一个不存在的旋钮。（第一版我用的是 sat|<档>|<target>|<局号> 这种**不同 seed**，结果比的是
// 两批不同的盘，n=20 时直接给出 med(0)=12 > med(4)=10 这种反号读数 —— 配对了才有牙齿。）
console.log('\n[H 饱和点：target 这个旋钮在低段是不是空的（同 seed 配对，只换停止规则）]');
{
  const deep = new Map();
  for (const t of TIERS) if (t.target === 0) deep.set(`${t.h}x${t.w}`, t.key);
  ok('H 每个尺寸都有一条 target=0 的深档可做配对（否则这一节会静默空跑）', deep.size >= 2, [...deep].map(([k, v]) => `${k}→${v}`).join(' '));
  const paired = (key, ta, tb) => {
    const d = [];
    for (let s = 0; s < SAMPLES; s++) {
      const seed = { rawSeed: `pair|${key}|${s}` };
      const a = produce(key, seed, { target: ta });
      const b = produce(key, seed, { target: tb });
      if (!a.ok || !b.ok) continue;                     // 只比"两边都出货"的对
      d.push([a.clues, b.clues]);
    }
    return d;
  };
  for (const [size, key] of deep) {
    const low = paired(key, 0, 4), up = paired(key, 8, 18);
    const same = low.filter(([a, b]) => a === b).length;
    const all = low.concat(up);
    const mono = all.filter(([a, b]) => a <= b).length;
    const gain = up.map(([a, b]) => b - a);
    console.log(`      ${size} (${key})：target 0 vs 4 → ${low.length} 对里 Δ=0 的 ${same} 对(${(100 * same / Math.max(1, low.length)).toFixed(0)}%)`
      + ` · target 8 vs 18 → ${up.length} 对里"要 18 条"比"要 8 条"多印 med ${pct(gain, .5)} 条`);
    ok(`H ${size} 停止规则单调（同一几何上 target 越小 ⇒ 出货线索数只会更少，不会更多）`,
      mono === all.length && all.length >= 8, `${mono}/${all.length} 对`);
    ok(`H ${size} 低段的 target 是空旋钮（要 0 条与要 4 条有 9 成以上出货同一张盘 ⇒ 深档只能命名为不可约）`,
      low.length >= 4 && same / low.length >= 0.9, `${same}/${low.length} 对一字不差`);
    ok(`H ${size} 上段的 target 是真旋钮（要 18 条的盘比要 8 条的多印 >=5 条线索）`,
      up.length >= 4 && pct(gain, .5) >= 5, `med ${pct(gain, .5)}（n=${up.length}）`);
  }
}

console.log(`\nBALANCE ${checks} checks / ${fails} failed  (SAMPLES=${SAMPLES}/档, ${TIERS.length} 档)`);
process.exit(fails ? 1 : 0);
