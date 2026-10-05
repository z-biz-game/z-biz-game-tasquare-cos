#!/usr/bin/env node
// 会话闸 · 持久层解码 / 帧率无关仿真 / 真静音 —— 三条"看代码觉得是"的话在这里变成数字
//
// 存在理由：这四道引擎闸证明的是**盘面**，浏览器闸证明的是**页面点得动**。中间有三件事
// 谁都没证明，而它们恰好是最容易在下次改动里悄悄坏掉的：
//   ① 存档坏一条是不是只丢那一条（坏一条丢全档 = 用户刷新后整盘没了，而页面照常报绿）；
//   ② 同一局在 30/60/120Hz 上跑出的动效与时钟是不是同一个东西（吃帧 dt 的实现只在高刷屏上"更快"，
//      而没人会拿 30Hz 的机器去点它）；
//   ③ 静音是真停了 AudioContext，还是把 gain 设成 0（后者照建节点、照花钱，只是听不见）。
//
// 跑法：  node tools/session-test.mjs
//
// 每段都写了"什么改动会让这段红"：
//   §1 索引两段解码   把逐条 try/catch 收成整包 try/catch ⇒ 坏一条丢全档，dropped/records 数对不上。
//   §2 盘面解码       再写第二份 parse（口径分叉）或把 seed 校验删掉 ⇒ 串盘/坏档那几条红。
//   §3 存储会抛        browserStorage 去掉 try/catch ⇒ Safari 隐私模式下开机就抛，这里先红。
//   §4 三档对拍       任何把帧 dt 带进逐实体积分的写法 ⇒ 同一虚拟时长下三档读数比值 > 3.6。
//   §5 reduceMotion   把它当"CSS 的事"而仿真里不分支 ⇒ suppressed 不涨、sparks 非 0。
//   §6 暂停与重开      漏 reset 一个字段，或暂停时仍累加 accum/elapsed ⇒ 那一条读数红。
//   §7 真静音         play() 先建节点再判 muted，或 setMuted 只改 gain ⇒ oscCreated 在静音期继续涨。
//   §8 阴性对照        这把尺子量不到东西的时候红（把 `accum += d` 改成 `accum += SIM_STEP` 必须让 §4 红）。

import { readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';

import {
  BOARD_PREFIX, ELAPSED_MAX, INDEX_KEY, INDEX_MAX, PREFS_KEY, boardKey, decodeBoard, decodeIndex,
  decodePrefs, decodeRecord, makeStore, browserStorage,
} from '../js/ui/store.js';
import { RIPPLE_LIFE, SIM_STEP, SPARK_LIFE, makeLcg, makeMotion } from '../js/ui/motion.js';
import { makeAudio } from '../js/ui/audio.js';
import { makeGame } from '../js/ui/game.js';

console.log('================================================================================');
console.log('TASQUARE SESSION-TEST — 两段解码 / 30·60·120Hz 定步对拍 / 真静音 / 阴性对照');
console.log(`node ${process.version} · SIM_STEP=${SIM_STEP.toFixed(6)}s · 时钟起点 1000ms · 比值阈值 3.6`);
console.log('================================================================================');

let checks = 0, fails = 0;
const ok = (gate, cond, detail = '') => {
  checks++;
  if (!cond) { fails++; console.log(`  FAIL ${gate}${detail ? ' :: ' + detail : ''}`); }
  else console.log(`  ok   ${gate}${detail ? ' :: ' + detail : ''}`);
};
const eq = (gate, got, want) => ok(gate, String(got) === String(want), `got=${got} want=${want}`);

/** 可注入的内存持久层：闸与页面跑的是**同一条** makeStore 路径，不是第二套实现。 */
const memStorage = (seed = {}) => {
  const m = new Map(Object.entries(seed));
  return { m, getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => { m.set(k, String(v)); return true; }, removeItem: (k) => m.delete(k) };
};

const TIER = 'easy-6x6';
const N = 36;                                      // easy-6x6 的格子数（6×6）
const clampMark = (s) => s.padEnd(N, '0').slice(0, N);

// ---------------------------------------------------------------- §1 索引两段解码
console.log('\n[§1 索引：坏一条只丢那一条]');
{
  const good = (round, elapsed = 12) => ({ tier: TIER, round, seed: `seed-${round}`, elapsed });
  // 十条里掺六种脏：null / 数字 / 字符串 / 数组 / 未知档位 / round 类型错 / seed 缺 / elapsed 类型错，
  // 外加两条**越界但不该丢**的（负数与 1e9 秒）—— 夹回边界，记 clamped。
  const arr = [
    good(1), null, 42, 'a string', [], { tier: 'nope-9x9', round: 2, seed: 's', elapsed: 1 },
    good(3), { tier: TIER, round: 'x', seed: 's', elapsed: 1 }, { tier: TIER, round: 4, elapsed: 1 },
    { tier: TIER, round: 5, seed: 's', elapsed: 'ten' }, good(6), { tier: TIER, round: 7, seed: 's', elapsed: -5 },
    good(8), { tier: TIER, round: 9, seed: 's', elapsed: 1e9 },
  ];
  const raw = JSON.stringify(arr);
  const r = decodeIndex(raw);
  ok('§1 十条脏样本没有让整份档消失（records 非空 = 两段式成立）', r.records.length > 0, `records=${r.records.length}`);
  eq('§1 总条数 = 喂进去的条数', r.total, arr.length);
  eq('§1 回来的条数', r.records.length, 6);
  eq('§1 丢掉的条数', r.dropped.length, arr.length - 6);
  eq('§1 被丢的都是且只是脏的那些（下标逐一对上；两条越界的没被丢，只是被夹回）', r.dropped.map((d) => d.i).join(','), '1,2,3,4,5,7,8,9');
  eq('§1 越界值走夹回而不是丢掉（elapsed<0 与 >ELAPSED_MAX 各一次）', r.clamped, 2);
  eq('§1 夹回后的两个读数', r.records.filter((x) => x.clamped).map((x) => x.elapsed).join(','), `0,${ELAPSED_MAX}`);
  eq('§1 回来的每一段都自己完整', r.records.every((x) => x.tier === TIER && /^[0-9a-z._-]+$/i.test(x.seed)), 'true');
  const reasons = Object.fromEntries(r.dropped.map((d) => [d.i, d.why]));
  eq('§1 null 条的失败原因', reasons[1], 'not-object');
  eq('§1 数字条的失败原因', reasons[2], 'not-object');
  eq('§1 字符串条的失败原因', reasons[3], 'not-object');
  eq('§1 数组条的失败原因', reasons[4], 'not-object');
  eq('§1 未知档位的失败原因', reasons[5], 'tier');
  eq('§1 round 类型错的失败原因', reasons[7], 'round');
  eq('§1 缺 seed 的失败原因', reasons[8], 'seed');
  eq('§1 elapsed 类型错的失败原因', reasons[9], 'elapsed-type');
  eq('§1 elapsed 负数不判死（只夹）', reasons[11], undefined);
  eq('§1 elapsed 1e9 不判死（只夹）', reasons[13], undefined);

  // 逐条隔离：把每一条脏样本单独塞进两份好档之间，坏的那条必须自己掉出去
  let isolated = 0, leaked = 0;
  for (const bad of [null, 42, 'x', [], { tier: 'nope', round: 0, seed: 's', elapsed: 0 }]) {
    const one = decodeIndex(JSON.stringify([good(1), bad, good(2)]));
    if (one.records.length === 2 && one.dropped.length === 1 && one.dropped[0].i === 1) isolated++;
    else leaked++;
  }
  eq('§1 每条脏样本单独都只伤到自己', isolated, 5);
  ok('§1 没有一条脏样本能连坐邻居', leaked === 0, `leaked=${leaked}`);

  // 第一段（拆包）失败：整包不是合法 JSON 时只能全丢，但要**记**它是 json 坏了而不是"没有档"
  const broken = decodeIndex('{ "records": [ , ');
  eq('§1 整包 JSON 坏 ⇒ bad=json', broken.bad, 'json');
  eq('§1 整包坏时不抛、只交空表', broken.records.length, 0);
  const notArray = decodeIndex('{"0":{"tier":"easy-6x6"}}');
  eq('§1 顶层不是数组 ⇒ bad=not-array', notArray.bad, 'not-array');
  eq('§1 空串/非串交回空表而不是抛', [decodeIndex('').bad, decodeIndex(null).bad, decodeIndex(7).bad].map((v) => String(v)).join(','), 'null,null,null');
  // 真实局号的形状必须活过解码：引擎的 seedOf 给的是 `tasquare|easy-6x6|0`（带竖线）。
  // 上一版把 seed 收成"只许字母数字点横杠"，这条就是红的地方 —— 续玩因此永远解不开。
  const realSeed = decodeIndex(JSON.stringify([{ tier: TIER, round: 0, seed: 'tasquare|easy-6x6|0', elapsed: 3 }]));
  eq('§1 带竖线的真实局号不被判脏（引擎 seedOf 就长这样）', realSeed.records.length, 1);
  eq('§1 它回来的就是那串 seed', realSeed.records[0] && realSeed.records[0].seed, 'tasquare|easy-6x6|0');
  eq('§1 带空格的 seed 仍算脏', decodeIndex(JSON.stringify([{ tier: TIER, round: 0, seed: 'a b', elapsed: 1 }])).dropped.map((d) => d.why).join(','), 'seed');
  eq('§1 超长 seed 算脏', decodeIndex(JSON.stringify([{ tier: TIER, round: 0, seed: 'x'.repeat(300), elapsed: 1 }])).dropped.length, 1);
}

// ---------------------------------------------------------------- §2 盘面解码与续玩
console.log('\n[§2 盘面：解码只有一条路径（store.decodeBoard ← game 续玩）]');
{
  const goodBoard = (seed, marks) => JSON.stringify({ seed, marks: clampMark(marks) });
  eq('§2 键名形状没变（浏览器闸的续局腿按它取证）', boardKey(TIER, 5), `${BOARD_PREFIX}${TIER}:5`);
  const len = (s) => clampMark(s).length;
  ok('§2 好档解得开且长度就是题面长度', decodeBoard(goodBoard('s1', '102'), N) !== null && decodeBoard(goodBoard('s1', '102'), N).marks.length === N);
  const junk = [
    ['坏 JSON', '{ "marks": "10'],
    ['裸 null', 'null'],
    ['裸数字', '34'],
    ['裸字符串', '"10101"'],
    ['数组而不是对象', '[1,0,1]'],
    ['缺 marks', '{"seed":"s1"}'],
    ['marks 非串', '{"seed":"s1","marks":101}'],
    ['marks 含非法字符', JSON.stringify({ seed: 's1', marks: '012'.repeat(12).slice(0, 35) + '3' })],
    ['marks 长度串盘', JSON.stringify({ seed: 's1', marks: '01' })],
    ['缺 seed', JSON.stringify({ marks: clampMark('0') })],
    ['seed 非串', JSON.stringify({ seed: 12345, marks: clampMark('0') })],
    ['seed 带空格', JSON.stringify({ seed: 'a b', marks: clampMark('0') })],
  ];
  for (const [name, raw] of junk) {
    let got = 'THREW';
    try { got = decodeBoard(raw, N) === null ? 'null' : 'DECODED'; } catch { got = 'THREW'; }
    eq(`§2 ${name} ⇒ 丢这一条（返回 null，绝不抛）`, got, 'null');
  }
  eq('§2 decodeBoard 不接受非串入参', [decodeBoard(null, N), decodeBoard(undefined, N), decodeBoard(0, N)].map((v) => String(v)).join(','), 'null,null,null');

  // 真走一遍页面那台状态机：makeGame 只认与本题面同尺寸、同 seed 的档
  const st1 = memStorage();
  const g1 = makeGame(TIER, 0, st1);
  const FREE_N = g1.counts().free;                  // 未知格只数自由格（线索格不在涂黑记账里）
  eq('§2 全新开局是全部自由格都为未知', g1.counts().unknown, FREE_N);
  const freeIdx = [];
  for (let i = 0; i < N; i++) if (g1.canEdit(i)) freeIdx.push(i);
  ok('§2 自由格够这条门取三格（线索格吃不了 mark，写死下标会静默失败）', freeIdx.length >= 3, `free=${freeIdx.length}/${N}`);
  g1.mark(freeIdx[0], 1); g1.mark(freeIdx[1], 2); g1.mark(freeIdx[2], 1);
  const savedMarks = st1.m.get(boardKey(TIER, 0));
  ok('§2 落子即时落盘（写的是 {seed,marks} 那一形状）', /"seed":"[^"]+","marks":"[012]+"/.test(savedMarks), savedMarks.slice(0, 80));
  const g2 = makeGame(TIER, 0, st1);
  eq('§2 重新装载 = 同一张涂黑（三格都在）', `${g2.counts().black}/${g2.counts().white}`, '2/1');
  eq('§2 续上来的那串与写进去的那串同一段', JSON.parse(savedMarks).marks, g2.saved.marks);
  const g3 = makeGame(TIER, 1, st1);
  eq('§2 换局号不吃上一局的档（局与局不串）', g3.counts().unknown, FREE_N);
  const st2 = memStorage({ [boardKey(TIER, 0)]: '{ "marks": ' });
  const g4 = makeGame(TIER, 0, st2);
  eq('§2 坏档不炸开机，交回全未知', g4.counts().unknown, FREE_N);
  const st3 = memStorage({ [boardKey(TIER, 0)]: JSON.stringify({ seed: 'other-seed', marks: clampMark('1') }) });
  const g5 = makeGame(TIER, 0, st3);
  eq('§2 seed 与本题面对不上 ⇒ 不续（宁可重开也不串盘）', g5.counts().unknown, FREE_N);
  const st4 = memStorage({ [boardKey(TIER, 0)]: JSON.stringify({ seed: g1.seed, marks: '01' }) });
  eq('§2 长度不符的档不续', makeGame(TIER, 0, st4).counts().unknown, FREE_N);
  const nosave = makeGame(TIER, 0, null);
  eq('§2 没有持久层也照样能玩（存储不是开机前置）', nosave.counts().unknown, FREE_N);
  ok('§2 没有第二份 parse 混在盘面路径里', !readFileSync('js/ui/game.js', 'utf8').includes('JSON.parse'));
}

// ---------------------------------------------------------------- §3 偏好 + 会抛的存储
console.log('\n[§3 偏好逐字段 / 存储抛异常也不崩]');
{
  const st = memStorage();
  const store = makeStore(st);
  ok('§3 门面报出可用', store.available === true);
  store.writePrefs({ muted: true, hintAuto: false, tier: TIER });
  const p = store.prefs();
  eq('§3 静音偏好存得回', `${p.muted}/${p.hintAuto}/${p.tier}`, `true/false/${TIER}`);
  eq('§3 好档不记坏字段', p.badFields.length, 0);
  const cases = [
    ['裸坏 JSON', '{muted', ['json']],
    ['顶层是数组', '[1]', ['shape']],
    ['muted 写成字符串', '{"muted":"yes"}', ['muted']],
    ['tier 是不存在的档', `{"tier":"nope-9x9"}`, ['tier']],
    ['缺字段只回默认值而不算坏（新装机器就这样）', '{"muted":false}', []],
  ];
  for (const [name, raw, want] of cases) {
    st.m.set(PREFS_KEY, raw);
    const r = store.prefs();
    eq(`§3 ${name} ⇒ 只退回那一个字段且其余给默认`, r.badFields.slice().sort().join(','), want.slice().sort().join(','));
    eq(`§3 ${name} 之后 muted 仍是布尔`, typeof r.muted, 'boolean');
  }
  st.m.set(PREFS_KEY, '{"muted":false}');
  eq('§3 缺的 tier 回的是默认 null（不是抛、不是空串）', String(store.prefs().tier), 'null');
  st.m.set(PREFS_KEY, '{"muted":true,"tier":"nope"}');
  const mixed = store.prefs();
  eq('§3 一个字段坏不牵连另一个字段（muted 仍读到 true）', `${mixed.muted}/${mixed.tier}`, 'true/null');

  // 索引读写：越界条数被裁到 INDEX_MAX，且写出去的是**瘦**记录（盘面串不跟着索引走）
  const many = Array.from({ length: 40 }, (_, i) => ({ tier: TIER, round: i, seed: `s${i}`, elapsed: i, marks: clampMark('1') }));
  store.writeIndex(many);
  const back = store.index();
  ok('§3 索引写入按上限裁条（40 条喂进去不会无限长）', back.total > 0 && back.total <= 24, `total=${back.total}`);
  ok('§3 索引里不带盘面串（每局一条在 board 键下，索引只是台账）', !String(st.m.get(INDEX_KEY)).includes('marks'));
  eq('§3 索引解码零丢弃', back.dropped.length, 0);

  // 存储会抛：Safari 隐私模式 / 配额耗尽时 localStorage 的三个方法都抛，不是返回 null
  const boom = new Error('SecurityError');
  const backup = globalThis.localStorage;
  let hooked = null;
  const hook = (v) => Object.defineProperty(globalThis, 'localStorage', { configurable: true, writable: true, value: v });
  try {
    hook({ getItem: () => { throw boom; }, setItem: () => { throw boom; }, removeItem: () => { throw boom; } });
  } catch (e) { hooked = e; }
  let threw = null, read = 'skipped', wrote = 'skipped', removed = 'skipped', downBoard = 'skipped', downPrefs = 'skipped';
  if (hooked === null) {
    try {
      read = browserStorage.getItem('x');
      wrote = browserStorage.setItem('x', '1');
      removed = browserStorage.removeItem('x');
      const storeDown = makeStore(browserStorage);
      downPrefs = storeDown.prefs().muted;
      downBoard = storeDown.board(TIER, 0);
    } catch (e) { threw = e; }
    hook(backup);
  } else {
    ok('§3 能覆盖 globalThis.localStorage（覆盖不了这段就是空跑）', false, String(hooked && hooked.message));
  }
  ok('§3 存储抛时页面不会崩（异常被吃掉，没有冒出 browserStorage）', threw === null, threw && threw.message);
  eq('§3 读失败给 null', read, null);
  eq('§3 写失败给 false', String(wrote), 'false');
  eq('§3 删失败给 false', String(removed), 'false');
  ok('§3 失败原因留在 lastError 上（不是只在控制台冒一句）', /getItem:/.test(String(browserStorage.lastError)), String(browserStorage.lastError));
  eq('§3 存储挂着时解码仍交回默认偏好', downPrefs, false);
  eq('§3 存储挂着时读盘给 null（而不是抛）', downBoard, null);
}

// ---------------------------------------------------------------- §4 三档帧率对拍
console.log('\n[§4 三档对拍：30/60/120Hz 喂同一段虚拟时长，按 sim step 对齐]');

const FIELDS = ['steps', 'elapsed', 'animClock', 'events', 'spawned', 'suppressed', 'ripples', 'sparks',
  'sparkSumX', 'sparkSumY', 'sparkAgeSum', 'rippleAgeSum'];

/**
 * 一条"帧率腿"：沙盒时钟从 1000ms 起，首帧 dt=0（与 app.js 的 frame() 同一形状），
 * 之后每帧吃 1/hz。落子事件**按步**触发（不是按帧），否则三档的事件数就不是同一件事。
 * @param factory (seed) => motion 实例（阴性对照传一份改过的 factory 进来跑同一段）
 */
function runLane(factory, { hz, seconds, seed = 20261002, reduced = false, emitEverySteps = 30 } = {}) {
  const m = factory({ reducedMotion: reduced, seed });
  m.start();
  const dt = 1 / hz;
  const T0 = 1000 / 1000;                           // 沙盒时钟起点 1000ms（换算成秒）
  // 时间戳用 **乘法** 给（起点 + f×dt），不靠累加：累加 720 次 1/120 会把舍入零头攒到能越过
  // 一个步长，那三档就差一步 —— 探针自己的噪声不该混进结论里。
  const tAt = (f) => T0 + f * dt;
  let nextEmit = emitEverySteps;
  const byStep = new Map();
  // +1 帧是为了补掉"首帧 dt=0"：不补的话三条腿各少一帧的仿真时间（1/30 与 1/120 少得不一样），
  // 对拍就变成了比谁丢的零头多。补上之后每条腿恰好推进 seconds 秒。
  const frames = Math.round(seconds * hz) + 1;
  for (let f = 0; f < frames; f++) {
    const d = f === 0 ? 0 : tAt(f) - tAt(f - 1);    // 首帧 dt=0：不吃"页面打开之前"的那段
    m.tick(d);
    while (emitEverySteps && m.st.steps >= nextEmit) {
      m.emit(nextEmit, { row: 1, col: 2, kind: 'mark' });
      nextEmit += emitEverySteps;
    }
    byStep.set(m.st.steps, m.snapshot());
  }
  return { hz, frames, final: m.snapshot(), byStep, st: m.st };
}

const INT_FIELDS = ['steps', 'events', 'spawned', 'suppressed', 'ripples', 'sparks'];

/** 同一 steps 上的读数：整数类字段必须逐个相等，浮点类容许一步以内的老化差（那是探针的舍入，不是语义）。 */
function alignByStep(lanes, eps = SIM_STEP * 3) {
  const common = [...lanes[0].byStep.keys()].filter((k) => lanes.every((l) => l.byStep.has(k)));
  let worstFloat = 0, worstWhere = '', intMismatch = 0;
  for (const k of common) {
    for (const f of FIELDS) {
      const vals = lanes.map((l) => l.byStep.get(k)[f]);
      const d = Math.max(...vals) - Math.min(...vals);
      if (INT_FIELDS.includes(f)) { if (d !== 0) intMismatch++; }
      else if (d > worstFloat) { worstFloat = d; worstWhere = `${f}@step${k}(Δ=${d.toExponential(2)})`; }
    }
  }
  return { common: common.length, compared: common.length * FIELDS.length, worstFloat, worstWhere, intMismatch, eps };
}

/** 同一段虚拟时长的**终点**读数比值：max/min，>3.6 判为帧相关（阈值来自 BRIEF_COS §3）。 */
function endRatio(lanes, field) {
  const vals = lanes.map((l) => l.final[field]);
  const max = Math.max(...vals), min = Math.min(...vals);
  if (max === 0 && min === 0) return { max, min, ratio: 1 };
  if (min <= 0) return { max, min, ratio: Infinity };
  return { max, min, ratio: max / min };
}

const LANES = [30, 60, 120].map((hz) => runLane(makeMotion, { hz, seconds: 6 }));
{
  eq('§4 三条腿的帧数（hz×6 秒，再加一帧补掉首帧 dt=0）', LANES.map((l) => l.frames).join(','), '181,361,721');
  const endSteps = LANES.map((l) => l.final.steps);
  ok('§4 三档终点步数一致（极差 ≤1：时间戳舍入的量级，不是语义差）',
    Math.max(...endSteps) - Math.min(...endSteps) <= 1, `30Hz=${endSteps[0]} 60Hz=${endSteps[1]} 120Hz=${endSteps[2]}`);
  ok('§4 这 6 秒确实推进了约 360 步（定步长，不是按帧数走的）', Math.min(...endSteps) >= 358, `min=${Math.min(...endSteps)}`);
  const al = alignByStep(LANES);
  ok('§4 按 sim step 对齐有足够可比样本', al.common > 150, `共同步数样本=${al.common} 比对次数=${al.compared}`);
  eq('§4 同步数上整数类字段零失配（steps/events/spawned/suppressed/ripples/sparks）', al.intMismatch, 0);
  ok(`§4 同步数上浮点类最坏偏差小于 3 步老化（实测最坏处 ${al.worstWhere || '无失配'}）`, al.worstFloat < al.eps, `worst=${al.worstFloat.toExponential(3)}`);
  console.log('      终点读数（30/60/120Hz 同一段 6 秒虚拟时长）：');
  let worst = { field: null, ratio: 0 };
  for (const f of FIELDS) {
    const r = endRatio(LANES, f);
    const fmt = (v) => (Number.isInteger(v) ? String(v) : v.toFixed(6));
    console.log(`      ${f.padEnd(13)} ${fmt(LANES[0].final[f]).padStart(12)} ${fmt(LANES[1].final[f]).padStart(12)} ${fmt(LANES[2].final[f]).padStart(12)}  max/min=${r.ratio === Infinity ? '∞' : r.ratio.toFixed(6)}`);
    ok(`§4 ${f} 的三档比值 ≤ 3.6`, r.ratio <= 3.6, `ratio=${r.ratio === Infinity ? '∞' : r.ratio.toFixed(6)}`);
    if (r.ratio > worst.ratio) worst = { field: f, ratio: r.ratio };
  }
  console.log(`      最坏字段：${worst.field} 比值 ${worst.ratio.toFixed(6)}（阈值 3.6）`);
  ok('§4 全场最坏比值远好于阈值（一步舍入也不会把比值推过 1.01）', worst.ratio <= 1.01, `worst=${worst.ratio.toFixed(9)} @${worst.field}`);
  for (const l of LANES) {
    ok(`§4 ${l.hz}Hz 的累加器余数小于一帧（残差留在 accum 里而不是补进仿真）`, l.st.accum < SIM_STEP + 1e-12, `accum=${l.st.accum.toFixed(9)}`);
  }
  // 长帧（切后台回来）不许追帧：一帧 3 秒只补 MAX_FRAME_DT 那么多
  const stall = runLane(makeMotion, { hz: 60, seconds: 0 });
  const m2 = makeMotion({ reducedMotion: false, seed: 20261002 });
  m2.start(); m2.tick(3);                            // 单帧 3 秒
  ok('§4 单帧 3 秒只补 0.25 秒的步（追帧=一次性几百步，回来会看到一坨过期粒子）', m2.st.steps <= 16, `steps=${m2.st.steps}`);
  eq('§4 零时长样本没被污染（只有一帧 dt=0 ⇒ 0 步）', stall.final.steps, 0);
}

// ---------------------------------------------------------------- §5 reduceMotion
console.log('\n[§5 reduceMotion 是真分支]');
{
  const full = runLane(makeMotion, { hz: 60, seconds: 6, reduced: false });
  const cut = runLane(makeMotion, { hz: 60, seconds: 6, reduced: true });
  eq('§5 命中时一个墨点都不生成（sparks=0）', cut.final.sparks, 0);
  eq('§5 命中时 spawned 不涨', cut.final.spawned, 0);
  ok('§5 被压掉的生成请求有计数（不是静默丢弃，且与事件数一一对上）',
    cut.final.suppressed === full.final.events && cut.final.suppressed > 0, `suppressed=${cut.final.suppressed} events=${full.final.events}`);
  eq('§5 事件数照旧（涟漪是"操作有回应"的那半，不减动效不关掉反馈）', cut.final.events, full.final.events);
  eq('§5 涟漪仍生成', cut.final.ripples > 0 || cut.final.rippleAgeSum > 0 ? 'yes' : 'no', 'yes');
  eq('§5 时钟与步数完全不受影响（关掉的是"动"，不是判定）', `${cut.final.steps}/${cut.final.elapsed.toFixed(6)}`, `${full.final.steps}/${full.final.elapsed.toFixed(6)}`);
  const m = makeMotion({ reducedMotion: true, seed: 1 });
  m.start();
  m.emit(0, { row: 0, col: 0 });
  eq('§5 命中态 emit 返回 0 个粒子', m.emit(1, { row: 1, col: 1 }), 0);
  m.setReducedMotion(false);
  eq('§5 运行时关掉 reduceMotion 立刻恢复生成', m.emit(2, { row: 0, col: 0 }) > 0, 'true');
  // 对拍可复现的前提：随机只用内置 LCG（Math.random 会让三档比的是掷骰子）
  const seqA = Array.from({ length: 200 }, makeLcg(20261002));
  const seqB = Array.from({ length: 200 }, makeLcg(20261002));
  const seqC = Array.from({ length: 200 }, makeLcg(20261003));
  eq('§5 同种子的 LCG 两条 200 个数逐位相同', seqA.every((v, i) => v === seqB[i]) ? 'same' : 'differs', 'same');
  ok('§5 换种子立刻换序列（否则"固定种子"是假的）', seqA.some((v, i) => v !== seqC[i]));
  ok('§5 LCG 落在 [0,1) 内', seqA.every((v) => v >= 0 && v < 1));
  const again = runLane(makeMotion, { hz: 60, seconds: 6 });
  eq('§5 同种子同帧率的整条腿可复现（终点质心逐位相同）',
    again.final.sparkSumX === LANES[1].final.sparkSumX ? 'same' : 'differs', 'same');
}

// ---------------------------------------------------------------- §6 暂停与重开
console.log('\n[§6 暂停一步都不跑 / 重开全部归零]');
{
  const m = makeMotion({ reducedMotion: false, seed: 7 });
  m.start();
  for (let i = 0; i < 60; i++) m.tick(1 / 60);       // 1 秒
  const before = m.snapshot();
  ok('§6 跑了一秒有步数', before.steps === 60, `steps=${before.steps}`);
  m.pause();
  for (let i = 0; i < 120; i++) m.tick(1 / 60);      // 暂停期间喂两秒
  const during = m.snapshot();
  eq('§6 暂停期间步数不涨', during.steps, before.steps);
  eq('§6 暂停期间思考时长不涨', during.elapsed, before.elapsed);
  eq('§6 暂停期间视觉时钟不涨', during.animClock, before.animClock);
  eq('§6 暂停期间累加器既不涨也不被消费', during.accum, before.accum);
  eq('§6 暂停期间粒子冻在原处', [during.sparkSumX, during.sparkSumY, during.sparkAgeSum].map((v) => v.toFixed(6)).join(','), [before.sparkSumX, before.sparkSumY, before.sparkAgeSum].map((v) => v.toFixed(6)).join(','));
  m.resume();
  for (let i = 0; i < 60; i++) m.tick(1 / 60);
  eq('§6 恢复后继续走（且不追帧：暂停那两秒没补进步数）', m.st.steps, before.steps + 60);
  m.emit(3, { row: 1, col: 1 });
  const dirty = m.snapshot();
  ok('§6 脏状态确实存在（否则"重开归零"是空断言）', dirty.steps > 0 && (dirty.spawned > 0 || dirty.ripples > 0), JSON.stringify(dirty).slice(0, 120));
  m.reset();
  const zero = m.snapshot();
  const nonzero = FIELDS.filter((f) => zero[f] !== 0);
  eq(`§6 重开后 ${FIELDS.length} 个读数全部归零（漏一个就是接着上一局的动效）`, nonzero.join(','), '');
  eq('§6 重开后涟漪与粒子清空', `${m.st.ripples.length}/${m.st.sparks.length}`, '0/0');
  eq('§6 重开后 running 归 false（等 start 才继续计时）', m.st.running, 'false');
  // 重开之后再跑一步仍要能从零开始（计数器不是只清了一半）
  m.start(); m.tick(1 / 60);
  eq('§6 重开后能继续跑且只走一步', m.st.steps, 1);
}

// ---------------------------------------------------------------- §7 真静音
console.log('\n[§7 真静音：静音态不建节点，且 AudioContext 真被 suspend]');
{
  const made = [];
  class FakeCtx {
    constructor() { this.state = 'running'; this.currentTime = 0; made.push(this); }
    createOscillator() { this.osc = (this.osc || 0) + 1; return { type: '', frequency: { setValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect: () => ({ connect: () => {} }), start() {}, stop() {} }; }
    createGain() { return { gain: { setValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect: () => ({ connect: () => {} }) }; }
    suspend() { this.susp = (this.susp || 0) + 1; this.state = 'suspended'; }
    resume() { this.res = (this.res || 0) + 1; this.state = 'running'; }
    get destination() { return {}; }
  }
  const a = makeAudio(FakeCtx);
  eq('§7 起手不建 AudioContext（首次手势之前建了也只是挂着）', made.length, 0);
  eq('§7 未静音时 play 返回 true', a.play('mark'), true);
  eq('§7 建了一次上下文', made.length, 1);
  eq('§7 三次播放建三个振荡器', [a.play('erase'), a.play('win')].join(','), 'true,true');
  eq('§7 oscCreated', a.stats().oscCreated, 3);
  eq('§7 静音返回 true', a.setMuted(true), true);
  eq('§7 静音把 ctx 真停了（state=suspended）', made[0].state, 'suspended');
  eq('§7 suspend 调用次数', a.stats().suspends, 1);
  for (let i = 0; i < 5; i++) a.play('mark');
  eq('§7 静音期间一个节点都没新建（不是 gain=0 的假静音）', a.stats().oscCreated, 3);
  eq('§7 静音期间的播放请求被记成 blocked', a.stats().blocked, 5);
  eq('§7 静音期间 play 返回 false', a.play('win'), false);
  eq('§7 静音期间 ctx 状态仍是 suspended', made[0].state, 'suspended');
  a.setMuted(false);
  eq('§7 取消静音是 resume 而不是重建', made.length, 1);
  eq('§7 取消静音后 ctx 回到 running', made[0].state, 'running');
  a.play('mark');
  eq('§7 取消静音后能再次发声', a.stats().oscCreated, 4);
  const a2 = makeAudio(null);                        // 环境没有 WebAudio
  eq('§7 没有 WebAudio 时 play 只是返回 false（不抛）', a2.play('mark'), false);
  eq('§7 没有 WebAudio 时读数标成 no-context', a2.stats().state, 'no-context');
  eq('§7 四个音色都在表上', a.voices().join(','), 'mark,erase,invalid,win');
}

// ---------------------------------------------------------------- §8 阴性对照
console.log('\n[§8 阴性对照：把定步长那行改成吃帧 dt，§4 必须红]');
{
  const src = readFileSync('js/ui/motion.js', 'utf8');
  const needle = 'st.accum += d;';
  const hits = src.split(needle).length - 1;
  eq('§8 靶子在源码里恰好一处（多于一处就是改错了地方，对照会假红/假绿）', hits, 1);
  const mutatedText = src.replace(needle, 'st.accum += SIM_STEP;   // NEGATIVE CONTROL');
  ok('§8 变异确实落进源码文本（替换失败会让这段白跑）', mutatedText !== src);
  const p = `${tmpdir()}/tasquare-motion-nc-${process.pid}-${Math.floor(makeLcg(9)() * 1e6)}.mjs`;
  writeFileSync(p, mutatedText);
  const nc = await import(pathToFileURL(p).href);
  const lanes = [30, 60, 120].map((hz) => runLane(nc.makeMotion, { hz, seconds: 6 }));
  const steps = lanes.map((l) => l.final.steps);
  const r = endRatio(lanes, 'steps');
  console.log(`      变异体终点步数（30/60/120Hz）= ${steps.join(' / ')} · max/min=${r.ratio.toFixed(4)}`);
  ok('§8 阴性对照真的红了（比值越过 3.6）', r.ratio > 3.6, `ratio=${r.ratio.toFixed(4)}`);
  ok('§8 红的方式与预期一致（步数恰好等于帧数 = 每帧被塞进一步，正是吃帧 dt 的形状）',
    steps[0] === lanes[0].frames && steps[1] === lanes[1].frames && steps[2] === lanes[2].frames,
    `steps=${steps.join(',')} frames=${lanes.map((l) => l.frames).join(',')}`);
  // 变异体在**同一步数**上仍然与正身逐字段相同 —— 这正是为什么必须两种对齐都做
  const trueLane = lanes[0];
  const pureLane = LANES[0];
  const k = 2 * Math.floor(Math.min(steps[0], pureLane.final.steps) / 2);   // 正身 30Hz 只落在偶数步上
  const a = trueLane.byStep.get(k), b = pureLane.byStep.get(k);
  eq(`§8 只看"同步数读数"会放走这个 bug（step${k} 上两者逐字段相同，所以 §4 的终点比值不是可省的那一半）`,
    a && b && FIELDS.every((f) => Math.abs(a[f] - b[f]) < 1e-12) ? 'identical' : 'differs', 'identical');
  const badElapsed = endRatio(lanes, 'elapsed');
  ok('§8 思考时长也跟着失真（暂停/续局读的是它）', badElapsed.ratio > 3.6, `ratio=${badElapsed.ratio.toFixed(4)}`);
  console.log(`      寿命口径核对：RIPPLE_LIFE=${RIPPLE_LIFE}s SPARK_LIFE=${SPARK_LIFE}s（两档都在 6 秒内自然老死，样本不靠截断）`);
}

// ---------------------------------------------------------------- §9 指针坐标换算
console.log('\n[§9 坐标换算：先减 rect，再按 CSS 像素除（dpr≠1 时两套尺度）]');
{
  const calls = { setTransform: [], cleared: 0, arcs: 0, rects: 0, imgs: 0 };
  const ctxStub = {
    setTransform: (a, b, c, d, e, f) => calls.setTransform.push([a, b, c, d, e, f]),
    clearRect: () => { calls.cleared++; },
    beginPath: () => {}, arc: () => { calls.arcs++; }, stroke: () => {}, fillRect: () => { calls.rects++; },
    drawImage: () => { calls.imgs++; },
  };
  let strokeStyle = '', fillStyle = '';
  Object.defineProperty(ctxStub, 'strokeStyle', { get: () => strokeStyle, set: (v) => { strokeStyle = v; } });
  Object.defineProperty(ctxStub, 'fillStyle', { get: () => fillStyle, set: (v) => { fillStyle = v; } });
  const canvas = { width: 0, height: 0, style: {}, getContext: () => ctxStub };
  const RECT = { left: 100, top: 200, width: 384, height: 384, right: 484, bottom: 584 };
  const board = { getBoundingClientRect: () => RECT };
  const okWindow = (() => {
    try {
      Object.defineProperty(globalThis, 'window', { configurable: true, writable: true, value: { devicePixelRatio: 3 } });
      Object.defineProperty(globalThis, 'getComputedStyle', {
        configurable: true, writable: true,
        value: () => ({ getPropertyValue: (k) => (k === '--cell' ? '48px' : k === '--cols' ? '8' : '') }),
      });
      return true;
    } catch { return false; }
  })();
  ok('§9 桩件装上了（装不上这三段就是空跑）', okWindow);
  if (okWindow) {
    const { makeFx } = await import(pathToFileURL(`${process.cwd()}/js/ui/fx.js`).href);
    const fx = makeFx(canvas);
    const g = fx.layout(board);
    eq('§9 量到的 CSS 尺寸进几何（384×384）', `${g.w}x${g.h}`, '384x384');
    eq('§9 一格 CSS 尺度 = --cell 的实测值', g.cell, 48);
    eq('§9 列数 = --cols', g.cols, 8);
    eq('§9 行数 = 高度 / 一格', g.rows, 8);
    eq('§9 dpr=3 ⇒ 位图边长 = CSS×3', `${canvas.width}x${canvas.height}`, '1152x1152');
    eq('§9 CSS 尺寸仍写回 style（不然画布会被拉糊）', `${canvas.style.width} ${canvas.style.height}`, '384px 384px');
    eq('§9 ctx 的变换矩阵带的是 dpr', calls.setTransform[0].slice(0, 2).join(','), '3,0');
    const hit = fx.hitCell(RECT.left + 48 * 2 + 6, RECT.top + 48 * 5 + 6);
    eq('§9 视口坐标 → (row5,col2) 的下标', hit && `${hit.row},${hit.col},${hit.i}`, '5,2,42');
    const naive = fx.hitCell(48 * 2 + 6, 48 * 5 + 6);
    ok('§9 "不减 rect" 得到的是另一个格子（这条门不是自证空气）', naive !== hit && String(naive && naive.i) === '0', JSON.stringify(naive));
    eq('§9 盘外一律给 null（不吃到隔壁 HUD 上去）', String(fx.hitCell(RECT.right + 1, RECT.top + 1)), 'null');
    eq('§9 左上角之外也是 null', String(fx.hitCell(RECT.left - 1, RECT.top - 1)), 'null');
    const m = makeMotion({ reducedMotion: false, seed: 5 });
    m.start(); m.emit(0, { row: 3, col: 3 });
    eq('§9 一帧画出涟漪与墨点（贴图没到走方点兜底）', fx.draw(m, { RIPPLE_LIFE, SPARK_LIFE }) > 0 ? 'yes' : 'no', 'yes');
    eq('§9 精灵没加载时走方点而不是空转', calls.rects > 0 && calls.imgs === 0 ? 'square' : 'other', 'square');
    const cut = makeMotion({ reducedMotion: true, seed: 5 });
    cut.start(); cut.emit(0, { row: 3, col: 3 });
    const drawnCut = cut.snapshot();
    eq('§9 reduceMotion 下 draw 只画涟漪、粒子数为 0', drawnCut.sparks, 0);
    Object.defineProperty(globalThis, 'window', { configurable: true, writable: true, value: { devicePixelRatio: 9 } });
    const fx9 = makeFx(canvas);
    eq('§9 dpr=9 被夹到 4（位图尺寸失控比糊更贵）', fx9.layout(board).dpr, 4);
  }
}

// ---------------------------------------------------------------- §10 service worker 策略
console.log('\n[§10 sw.js：版本号进 cache 名 · 子资源网络优先 · SHELL 每条都得真在磁盘上]');
{
  const { existsSync } = await import('node:fs');
  const handlers = {};
  const cacheLog = { opened: [], added: null, keys: 0, deleted: [], puts: 0, matches: 0 };
  const fakeCache = {
    addAll: (list) => { cacheLog.added = list; return Promise.resolve(); },
    put: () => { cacheLog.puts++; return Promise.resolve(); },
    // './index.html' 那一条给命中，其余给未命中 —— 导航兜底那条腿必须有东西可兜，
    // 否则 §10 的"两头落空兜回 shell"是在比一个空桩件的行为。
    match: (q) => {
      cacheLog.matches++;
      const u = typeof q === 'string' ? q : (q && q.url) || '';
      return Promise.resolve(u.includes('index.html') ? { ok: true, shell: true } : undefined);
    },
  };
  Object.defineProperty(globalThis, 'caches', {
    configurable: true, writable: true,
    value: {
      open: (name) => { cacheLog.opened.push(name); return Promise.resolve(fakeCache); },
      // 当前版本名从 install 实测那一个来（也就是 sw.js 里的 VERSION），不写死：写死的话每次正当
      // bump VERSION 都得回来改这根桩件，而 bump 本身正是这条腿要保护的动作。stale 那条故意取成
      // 不带 v数字 的名字，免得它自己撞上某个真发过货的版本号。
      keys: () => { cacheLog.keys++; return Promise.resolve(['tasquare-stale', cacheLog.opened[0] || 'tasquare-stale']); },
      delete: (k) => { cacheLog.deleted.push(k); return Promise.resolve(true); },
    },
  });
  let fetchMode = 'ok';
  Object.defineProperty(globalThis, 'fetch', {
    configurable: true, writable: true,
    value: () => {
      if (fetchMode === 'throw') return Promise.reject(new Error('offline'));
      if (fetchMode === 'notok') return Promise.resolve({ ok: false, status: 503, clone() { return this; } });
      return Promise.resolve({ ok: true, status: 200, clone() { return this; } });
    },
  });
  const waitUntil = [];
  let responded = null;
  Object.defineProperty(globalThis, 'self', {
    configurable: true, writable: true,
    value: {
      location: { origin: 'https://z-biz-game.github.io' },
      addEventListener: (kind, fn) => { handlers[kind] = fn; },
      skipWaiting: () => Promise.resolve(),
      clients: { claim: () => Promise.resolve() },
    },
  });
  ok('§10 self/caches/fetch 桩件装上', typeof globalThis.self.addEventListener === 'function' && typeof globalThis.caches.open === 'function');
  await import(pathToFileURL(`${process.cwd()}/sw.js`).href);
  eq('§10 install/activate/fetch 三个 handler 都注册上了', ['install', 'activate', 'fetch'].filter((k) => handlers[k]).join(','), 'install,activate,fetch');

  handlers.install({ waitUntil: (p) => waitUntil.push(p) });
  await Promise.all(waitUntil);
  const version = cacheLog.opened[0];
  ok(`§10 cache 名带版本号（实测 "${version}"）`, /^tasquare-v\d+$/.test(String(version)), version);
  const shell = cacheLog.added || [];
  eq('§10 预缓存清单是 12 条（页面 + 样式 + manifest + 位图）', shell.length, 12);
  const missing = shell.filter((p) => p !== './' && !existsSync(p.replace(/^..\//, '').replace(/^\.\//, '')));
  eq(`§10 SHELL 里每一条都真在磁盘上（缺就是线上 404 而 SW 全绿）`, missing.join(','), '');
  ok('§10 SHELL 覆盖新增的三张位图与精灵', ['paper-grain', 'ink-block', 'spark'].every((n) => shell.some((p) => p.includes(n))), shell.join(' '));

  handlers.activate({ waitUntil: (p) => waitUntil.push(p) });
  await waitUntil[waitUntil.length - 1];
  eq('§10 activate 只删旧版本 cache（不是把当前版本也删了）', cacheLog.deleted.join(','), 'tasquare-stale');
  ok(`§10 当前版本 "${version}" 不在被删的那一批里`, !cacheLog.deleted.includes(version), cacheLog.deleted.join(','));

  const mkReq = (url, method = 'GET', mode = 'cors') => ({ url, method, mode });
  responded = null;
  handlers.fetch({ request: mkReq('https://z-biz-game.github.io/x/js/ui/app.js'), respondWith: (p) => { responded = p; } });
  const got = await responded;
  ok('§10 同源子资源走网络（网络优先的实现体：拿到的是 fetch 的那个响应）', got && got.ok === true);
  eq('§10 网络成功时不去查 cache.match（cache-first 会把改版后的旧 JS 钉住）', cacheLog.matches, 0);
  eq('§10 非导航请求成功后写进缓存', cacheLog.puts, 1);

  fetchMode = 'throw';
  cacheLog.matches = 0;
  handlers.fetch({ request: mkReq('https://z-biz-game.github.io/x/css/style.css'), respondWith: (p) => { responded = p; } });
  const fallback = await responded.catch((e) => `REJECT:${e.message}`);
  eq('§10 网络抛了才退缓存（这里查了一次 match）', cacheLog.matches, 1);
  ok('§10 缓存也没命中时非导航请求让这条 reject 冒出来（不假装成功）', String(fallback).startsWith('REJECT:'), String(fallback));

  cacheLog.matches = 0;
  handlers.fetch({ request: mkReq('https://z-biz-game.github.io/x/', 'GET', 'navigate'), respondWith: (p) => { responded = p; } });
  const nav = await responded.catch((e) => `REJECT:${e.message}`);
  ok('§10 导航请求两头落空兜回 shell（装机后离线能开页）', !!nav && nav.shell === true, String(JSON.stringify(nav)).slice(0, 40));
  eq('§10 兜底走的是 cache.match("./index.html")', cacheLog.matches >= 2 ? 'yes' : 'no', 'yes');

  fetchMode = 'ok';
  let crossHandled = false;
  handlers.fetch({ request: mkReq('https://cdn.example.com/lib.js'), respondWith: () => { crossHandled = true; } });
  eq('§10 跨源一律不接管（本仓零外部依赖）', crossHandled, false);
  let postHandled = false;
  handlers.fetch({ request: mkReq('https://z-biz-game.github.io/x/api', 'POST'), respondWith: () => { postHandled = true; } });
  eq('§10 非 GET 不接管', postHandled, false);
  fetchMode = 'notok';
  cacheLog.puts = 0;
  handlers.fetch({ request: mkReq('https://z-biz-game.github.io/x/icons/icon-192.png'), respondWith: (p) => { responded = p; } });
  await responded;
  eq('§10 !res.ok 的响应不写进缓存（否则 503 会被钉住）', cacheLog.puts, 0);
}

// ---------------------------------------------------------------- §11 装机注册通道
console.log('\n[§11 pwa.js：file: 静默跳过 · 前缀形态按 baseURI 解析 · 注册失败不带走页面]');
{
  const calls = [];
  const setGlobal = (k, v) => {
    try { Object.defineProperty(globalThis, k, { configurable: true, writable: true, value: v }); return true; } catch { return false; }
  };
  const nav = { serviceWorker: { register: (url, opts) => { calls.push({ url, opts }); return Promise.resolve(nav.serviceWorker.__reg || { scope: new URL(opts.scope).href }); } } };
  ok('§11 navigator 桩件装上', setGlobal('navigator', nav) && setGlobal('location', { protocol: 'file:' }) && setGlobal('document', { baseURI: 'https://z-biz-game.github.io/z-biz-game-tasquare-cos/index.html' }));
  const pwaFile = pathToFileURL(`${process.cwd()}/js/ui/pwa.js`).href;
  const p1 = await import(pwaFile);
  const s1 = await p1.registerServiceWorker();
  eq('§11 file: 下一次注册都不发起（硬注册的实测结果是一条未捕获 SecurityError）', calls.length, 0);
  eq('§11 file: 的状态是 registered=false', s1.registered, false);
  ok('§11 file: 的说明写清了这是形态不是故障', /file:/.test(String(s1.error)) && /跳过/.test(String(s1.error)), String(s1.error));

  setGlobal('location', { protocol: 'https:' });
  const s2 = await p1.registerServiceWorker();
  eq('§11 前缀形态下 sw 的 URL 按 baseURI 解析（写死 /sw.js 会 404 而 404 是静默的）', calls[0] && calls[0].url, 'https://z-biz-game.github.io/z-biz-game-tasquare-cos/sw.js');
  eq('§11 scope 也跟着前缀', calls[0] && calls[0].opts.scope, 'https://z-biz-game.github.io/z-biz-game-tasquare-cos/');
  eq('§11 注册成功回到 registered=true', s2.registered, true);

  nav.serviceWorker.register = (url) => { calls.push({ url, opts: 'reject' }); return Promise.reject(new TypeError('404 not found')); };
  const s3 = await p1.registerServiceWorker().then((v) => ({ resolved: v, rejected: null }), (e) => ({ resolved: null, rejected: e }));
  ok('§11 注册失败被这条通道自己吞掉（promise 是 resolved，不是冒出去一条未捕获的 reject）',
    s3.rejected === null && !!s3.resolved, String(s3.rejected && s3.rejected.message));
  ok('§11 失败原因记在 error 上（HUD 与闸都读得到）', /404/.test(String(s3.resolved && s3.resolved.error)), String(s3.resolved && s3.resolved.error));

  setGlobal('navigator', {});
  const p2 = await import(`${pwaFile}?fresh=1`);
  const s4 = await p2.registerServiceWorker();
  eq('§11 环境不支持 SW 时原样交回状态、不建任何调用', s4.supported, false);
  eq('§11 不支持时也不抛、registered 仍为 false', String(s4.registered), 'false');
}

console.log('\n[§12 台账这条腿：写进去的是台账 · 接回来的是时钟 · 脏数字到不了 HUD]');
{
  const mem = new Map();
  const store = {
    getItem: (k) => (mem.has(k) ? mem.get(k) : null),
    setItem: (k, v) => { mem.set(k, String(v)); return true; },
    removeItem: (k) => { mem.delete(k); return true; },
  };
  const persist = makeStore(store);
  const m = makeMotion();

  eq('§12 起手台账为空（这条腿不是拿旧档自证）', persist.index().records.length, 0);
  persist.writeIndex([{ tier: 'easy-6x6', round: 0, seed: 'tasquare|easy-6x6|0', elapsed: 41.7 }]);
  const back = persist.index();
  eq('§12 写一条就读回一条', back.records.length, 1);
  eq('§12 索引里不塞盘面串（盘面在 board 键下，台账只管局号与用时）',
    String(mem.get(INDEX_KEY)).includes('marks'), 'false');
  eq('§12 读回的 marks 恒为 null', back.records[0].marks, null);
  eq('§12 落账的用时原样回来（floor 之后与 HUD 同一个数）', Math.floor(back.records[0].elapsed), 41);

  eq('§12 setElapsed 正数原样接回来', m.setElapsed(back.records[0].elapsed), 41.7);
  m.start();
  for (let s = 0; s < 60; s++) m.step(1 / 60);
  ok('§12 接回来的时钟接着走，不是只改一次显示', Math.abs(m.st.elapsed - 42.7) < 1e-6, `elapsed=${m.st.elapsed.toFixed(6)}`);
  eq('§12 NaN 判 0（脏数字不进时钟）', m.setElapsed(Number('ten')), 0);
  eq('§12 Infinity 判 0', m.setElapsed(Infinity), 0);
  eq('§12 负数判 0（时钟不许倒退）', m.setElapsed(-3), 0);
  eq('§12 undefined 判 0', m.setElapsed(undefined), 0);
  eq('§12 归零之后仍能正常接住好值', m.setElapsed(9), 9);

  // 越界用时：第一道在 decodeRecord 夹，第二道在 setElapsed 挡 —— 连起来不会把 1e9 秒喂给 HUD
  persist.writeIndex([{ tier: 'easy-6x6', round: 1, seed: 'tasquare|easy-6x6|1', elapsed: 1e9 }]);
  const dirty = persist.index();
  eq('§12 越界用时不判死那一条（夹回边界并记账）', dirty.records.length, 1);
  eq('§12 夹到的边界就是 ELAPSED_MAX', dirty.records[0].elapsed, ELAPSED_MAX);
  eq('§12 clamped 计数留痕', dirty.clamped, 1);
  eq('§12 夹过的值接进时钟还是同一个数（第二道不放大）', m.setElapsed(dirty.records[0].elapsed), ELAPSED_MAX);

  const many = Array.from({ length: INDEX_MAX + 6 }, (_, i) => ({
    tier: 'easy-6x6', round: i, seed: `tasquare|easy-6x6|${i}`, elapsed: i,
  }));
  persist.writeIndex(many);
  eq(`§12 台账条数上限由 writeIndex 自己裁到 ${INDEX_MAX}`, persist.index().records.length, INDEX_MAX);
  eq('§12 裁的是最旧的那些（新写的排在前面）', persist.index().records[0].round, 0);
}

console.log(`\nSESSION-TEST ${checks} checks / ${fails} failed`);
process.exit(fails ? 1 : 0);
