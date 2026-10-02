// 页面装配 · 只画不判 —— 判定全部来自 js/ui/game.js 背后的引擎
//
// 纪律：本文件里不许出现"合法/唯一解/推得完"这类结论的**实现**，只许出现引擎答复的**转述**；
// 也不许在这里写死档位或规则文案：档名/尺寸/线索区间/步数区间从 TIERS 现读，
// 条款句子读 CLAUSE_TEXT，提示的"为什么"读 pencil.js 的 CLAUSES，出处引文读 SOURCE_QUOTE。
//
// 这一层另外管四件与判定无关的事：时钟与动效（motion.js）、声音（audio.js）、
// 指针与键盘输入（含拖拽涂黑）、以及 HUD 上那几颗按钮的状态。四件都不许自己下结论。

import { BLK, MARK_TEXT, UNK, WHT, cellsOf, makeGame, tierList } from './game.js';
import { CLAUSE_TEXT, DEFAULTS, SOURCE_QUOTE, SOURCE_URL } from '../engine/rules.js';
import { registerServiceWorker } from './pwa.js';
import { RIPPLE_LIFE, SPARK_LIFE, makeMotion } from './motion.js';
import { makeAudio } from './audio.js';
import { makeStore, browserStorage } from './store.js';
import { makeFx } from './fx.js';

const $ = (id) => document.getElementById(id);
const tiers = tierList();
// localStorage 在隐私模式/Safari 下会**抛**，所以取用一律过 browserStorage 那层 try/catch。
const store = typeof localStorage !== 'undefined' ? browserStorage : null;
const persist = makeStore(store);

let game = null;
let pwa = {
  supported: typeof navigator !== 'undefined' && 'serviceWorker' in navigator,
  registered: false, scope: null, error: null,
};

const rmq = typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : null;
const motion = makeMotion({ reducedMotion: !!(rmq && rmq.matches), seed: 20261002 });
const audio = makeAudio();
const fx = typeof document !== 'undefined' && $('fx') ? makeFx($('fx')) : null;
let prefs = persist.prefs();   // 声明时就从存储读：首帧 load() 里就要 writePrefs，晚一步会把上次的 muted 盖掉

let lastTime = null;          // rAF 时间戳（秒）；null = 这一帧是首帧，dt 记 0 而不是"从 0 追到现在"
let wonFired = false;
let clockPainted = -1;

/** reduceMotion 命中：标题动效退化成静图，粒子与涟漪一个不生成（motion.js 那一侧真分支）。 */
const prefersReduced = () => !!(rmq && rmq.matches);

/** 局号是递增整数，**不许**由日期派生（那等于每天换一批盘，"换一局"就对不上任何公式）。 */
function parseHash(h) {
  const m = /^#?([0-9a-z._-]+)\/(\d+)$/i.exec(String(h || '').replace(/^#/, ''));
  if (!m) return null;
  return tiers.some((t) => t.key === m[1]) ? { tierKey: m[1], round: Number(m[2]) } : null;
}

function load(tierKey, round) {
  game = makeGame(tierKey, round, store);
  history.replaceState(null, '', `#${game.tierKey}/${game.round}`);   // 不触发 hashchange：换局只有一次 produce
  // 换局 = 动效与时钟整层复位。只 reset 不 start 的话下一帧的 dt 会全砸进第一步。
  motion.reset();
  lastTime = null;
  wonFired = false;
  clockPainted = -1;
  if (game.ok) motion.start();
  prefs.tier = tierKey;
  persist.writePrefs(prefs);
  relayout();
  render();
}

/** 页面上的静态文字全部来自引擎常量。 */
function renderStatic() {
  $('clauses').innerHTML = Object.values(CLAUSE_TEXT).map((s) => `<li>${s}</li>`).join('');
  $('quote').textContent = SOURCE_QUOTE.join('\n');
  $('source').textContent = `规则出处：Cross+A 英文索引 Tasukuea 条目（${SOURCE_URL}，检索日期 2026-09-29），上栏为逐字引文。`;
  $('knobs').textContent = '本仓口径（这三处源文本没定，换掉任何一处都是换游戏；量法见 tools/balance.mjs 的 G 节）：'
    + Object.entries(DEFAULTS).map(([k, v]) => `${k}=${JSON.stringify(v)}`).join(' · ');
  $('tiers').innerHTML = tiers.map((t) => (
    `<button type="button" class="tier" data-key="${t.key}"><b>${t.label}</b>`
    + `<span>${t.size} · 印刷线索 ${t.band[0]}–${t.band[1]} 条 · 铅笔 ${t.steps[0]}–${t.steps[1]} 步`
    + `${t.target === 0 ? ' · 裁到不可约' : ` · 目标 ${t.target} 条`}</span></button>`
  )).join('');
  for (const b of $('tiers').querySelectorAll('.tier')) {
    b.addEventListener('click', () => {
      const cur = parseHash(location.hash) || { tierKey: game.tierKey, round: game.round };
      load(b.dataset.key, cur.round);
    });
  }
  $('howto-list').innerHTML = [
    '左键 / 触摸：未知 → 黑 → 白 循环；按住拖动可以连着涂同一态。',
    '右键：黑 ↔ 未知（跳过"白"，注白交给左键的第二态）。',
    '键盘：方向键走格，Enter 或 空格 在焦点格落子。',
    '全局键：P 或 空格 暂停 · R 重开这一局 · N 再来一局 · M 静音 · F 全屏 · H 或 ? 收起/展开本说明。',
    '触屏上暂停时盘面不吃输入，但读数与存档都还在 —— 暂停停的是时钟与动效，不是这一局的事实。',
  ].map((s) => `<li>${s}</li>`).join('');
}

function renderBoard() {
  const board = $('board');
  if (!game.ok) { board.innerHTML = ''; board.hidden = true; if (fx) fx.layout(board); return; }
  board.hidden = false;
  const { face, marks } = game;
  board.style.setProperty('--cols', String(face.w));
  board.innerHTML = cellsOf(face).map((c) => {
    const m = c.clue ? null : marks[c.i];
    const cls = ['cell', c.clue ? 'clue' : 'free', c.clue ? '' : m === BLK ? 'blk' : m === WHT ? 'wht' : 'unk',
      c.qmark ? 'q' : ''].filter(Boolean).join(' ');
    const label = c.clue
      ? `线索格 ${c.r + 1},${c.j + 1}：${c.label}`
      : `格 ${c.r + 1},${c.j + 1}，当前${MARK_TEXT[m]}，回车换下一态`;
    const attrs = c.clue ? ' aria-readonly="true"' : ' tabindex="0"';
    return `<div class="${cls}" role="gridcell" data-i="${c.i}" data-r="${c.r}" data-j="${c.j}"`
      + ` aria-label="${label}"${attrs}>${c.clue ? `<span>${c.label}</span>` : ''}</div>`;
  }).join('');
  if (fx) fx.layout(board);
}

function renderStatus() {
  const reject = $('reject'), play = $('play');
  if (!game.ok) {
    play.hidden = true; reject.hidden = false;
    // 把上一局的读数擦干净：#status 是 aria-live，留着旧数字就等于同一张页面上同时说出
    // "这一局没出货"和"自由格 32：黑 1"两种结论。
    for (const id of ['seedline', 'status', 'result', 'cert', 'hintline']) $(id).textContent = '';
    $('violations').innerHTML = '';
    const rc = game.reject.receipt;
    $('reject-detail').textContent = `fail=${game.reject.fail} · draws=${game.reject.draws}`
      + (rc ? ` · 铺面 ${rc.layTried} 张 · 裁判调用 ${rc.shipRuns} 次` : '') + ` · seed=${game.seed}`;
    return;
  }
  play.hidden = false; reject.hidden = true;
  const { black, white, unknown, free } = game.counts();
  const v = game.verdict();
  $('seedline').textContent = `${game.tier.label} · 第 ${game.round} 局 · seed ${game.seed}`;
  $('status').textContent = `自由格 ${free}：黑 ${black} · 白 ${white} · 未知 ${unknown}`;
  $('violations').innerHTML = v.violations.map((x) => `<li><b>${x.text}</b><code>${x.msg}</code></li>`).join('');
  const r = $('result');
  r.className = `result${v.full ? (v.legal ? ' won' : ' bad') : ''}`;
  r.textContent = v.full ? (v.legal ? '完成：这张涂黑过规则模型的全部条款' : `填满了，但有 ${v.violations.length} 处不合条款`) : '';
  $('cert').textContent = v.legal ? (() => {
    const c = game.certify();
    return `出货凭证（浏览器现算，不是抄出题器的账）：count=${c.count} · 节点 ${c.nodes} · stopped=${c.stopped}`
      + ` · 线索 ${c.clues} 条 · 铅笔 ${c.pencilSteps} 步推完（未知 ${c.pencilUnknown}）· 命中规则 ${c.rules} 条`
      + ` · 与裁判交回的那张差 ${c.vsPlayer} 格`;
  })() : '';
  paintState(v);
  if (v.full && v.legal && !wonFired) {
    wonFired = true;
    audio.play('win');
    const f = game.face;
    motion.emit(-1, { row: f.h / 2, col: f.w / 2, kind: 'win' });
  } else if (!v.full) {
    wonFired = false;
  }
}

/** HUD 上那一行状态：暂停/时钟/动效/声音，全是转述，不做任何判定。 */
function paintState(v) {
  $('state').textContent = motion.st.paused ? '已暂停' : (game.ok ? (v && v.full && v.legal ? '已完成' : '思考中') : '未出货');
  $('state').dataset.paused = motion.st.paused ? '1' : '0';
  const s = Math.floor(motion.st.elapsed);
  if (s !== clockPainted) {
    clockPainted = s;
    $('clock').textContent = `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
  }
  $('motion-note').textContent = prefersReduced()
    ? '系统要求减少动效：涟漪与墨点已关（时钟与判定不受影响）'
    : `动效开 · 步长 ${(1 / 60).toFixed(4)}s · 已跑 ${motion.st.steps} 步`;
}

function render() {
  // 整块 innerHTML 重建会把焦点丢回 body：不找回同一格，"方向键走格 + 回车落子"就只能用一步。
  const focusI = document.activeElement && document.activeElement.dataset ? document.activeElement.dataset.i : null;
  renderBoard();
  renderStatus();
  markActiveTier();
  $('hintline').textContent = '';
  if (focusI != null) {
    const t = $('board').querySelector(`.cell[data-i="${focusI}"]`);
    if (t) { t.tabIndex = 0; t.focus({ preventScroll: true }); }
  }
}

/** 高亮当前档位：这是转述 game.tierKey，不是第二份状态（页面别处不许再存一个"当前档"）。 */
function markActiveTier() {
  if (!game) return;
  for (const b of $('tiers').querySelectorAll('.tier')) b.classList.toggle('on', b.dataset.key === game.tierKey);
}

// ---------------------------------------------------------------- HUD 动词
function setPaused(on) {
  if (on) motion.pause(); else motion.resume();
  document.body.classList.toggle('paused', !!on);
  $('pause').textContent = on ? '继续' : '暂停';
  $('pause').setAttribute('aria-pressed', on ? 'true' : 'false');
  lastTime = null;                       // 恢复的那一帧 dt 记 0：暂停期间的时间不进仿真
  paintState(null);
  return motion.st.paused;
}

/** 重开这一局：时钟、累加器、涟漪、墨点、我的涂黑、提示与结论**全部**复位（返回前后读数供闸比对）。 */
function restart() {
  const before = { ...motion.snapshot(), ...game.counts() };
  motion.reset();
  lastTime = null;
  wonFired = false;
  clockPainted = -1;
  if (game.ok) { game.clear(); motion.start(); }
  setPaused(false);
  render();
  return { before, after: { ...motion.snapshot(), ...game.counts() } };
}

function setMuted(on) {
  audio.setMuted(on);
  prefs.muted = !!on;
  persist.writePrefs(prefs);
  $('mute').textContent = on ? '已静音' : '有声音';
  $('mute').setAttribute('aria-pressed', on ? 'true' : 'false');
  return audio.muted();
}

function toggleFullscreen() {
  const host = document.fullscreenElement ? null : document.documentElement;
  if (document.fullscreenElement) {
    document.exitFullscreen().catch(() => {});
  } else if (host && host.requestFullscreen) {
    host.requestFullscreen({ navigationUI: 'hide' }).catch(() => {});
  }
  return !!document.fullscreenElement;
}

function toggleHelp(force) {
  const t = $('tutorial');
  const open = force === undefined ? t.hidden : !!force;
  t.hidden = !open;
  $('help').setAttribute('aria-expanded', open ? 'true' : 'false');
  return open;
}

// ---------------------------------------------------------------- 输入通道
/** 落子：唯一写盘通道。暂停态不吃输入（但存档与读数一律不动，那是"暂停"不是"重开"）。 */
function applyMark(i, v, { sound = true } = {}) {
  if (!game.ok || motion.st.paused) return false;
  const ok = v === undefined ? game.cycle(i) : game.mark(i, v);
  if (!ok) { audio.play('invalid'); return false; }
  const f = game.face;
  motion.emit(i, { row: Math.floor(i / f.w), col: i % f.w, kind: v === BLK ? 'mark' : 'cycle' });
  if (sound) audio.play(game.marks[i] === BLK ? 'mark' : game.marks[i] === WHT ? 'erase' : 'mark');
  render();
  return true;
}

function cellFromEvent(e) {
  const viaFx = fx && fx.hitCell(e.clientX, e.clientY);
  if (viaFx != null) return viaFx.i;
  const el = e.target && e.target.closest ? e.target.closest('.cell') : null;
  return el ? Number(el.dataset.i) : null;
}

let dragValue = null;

function onPointerDown(e) {
  audio.unlock();                                  // 首次手势里抬一下 AudioContext（自动播放策略）
  if (e.button === 2) return;                      // 右键交给 contextmenu
  const i = cellFromEvent(e);
  if (i == null || !game.canEdit(i)) return;
  const el = $(`board`).querySelector(`.cell[data-i="${i}"]`);
  if (el) { el.tabIndex = 0; el.focus({ preventScroll: true }); }
  if (e.pointerType === 'touch') e.preventDefault();   // 阻止双击缩放与兼容性 mouse 事件（不阻止就没法拖）
  const from = game.marks[i];
  const to = (from + 1) % 3;
  dragValue = to;                                  // 拖动期间锁定目标态：连涂同一态，不会来回循环
  applyMark(i, to);
}

function onPointerMove(e) {
  if (dragValue === null || !(e.buttons & 1)) return;
  const i = cellFromEvent(e);
  if (i == null || !game.canEdit(i) || game.marks[i] === dragValue) return;
  applyMark(i, dragValue);
}

function endDrag() { dragValue = null; }

/** 没有 PointerEvent 的回落通道：touchstart / mousedown 走同一条 applyMark，绝不与 pointerdown 并存触发。 */
function legacyPointFrom(targetTouches) {
  const t = targetTouches && targetTouches.length ? targetTouches[0] : null;
  return t ? { clientX: t.clientX, clientY: t.clientY, target: t.target } : null;
}

renderStatic();
load((parseHash(location.hash) || { tierKey: tiers[0].key, round: 0 }).tierKey,
  (parseHash(location.hash) || { tierKey: tiers[0].key, round: 0 }).round);

// 偏好起手：静音与"减少动效"都从盘上/系统读，不写死（prefs 在声明处已从存储读进来了）
if (prefs.muted) setMuted(true);
if (prefersReduced()) motion.setReducedMotion(true);
if (rmq && rmq.addEventListener) {
  rmq.addEventListener('change', (e) => {
    motion.setReducedMotion(e.matches);
    document.body.classList.toggle('reduced-motion', e.matches);
    paintState(null);
  });
}

$('next').addEventListener('click', () => load(game.tierKey, game.round + 1));
// 拒盘那块面板必须自己也能走人：#play 在这条分支里是 hidden 的，#next 根本点不到，
// 少这一行的话"这一局号没能出货"就是一张死路告示，而页面上唯一能换局的按钮藏在看不见的那块里。
$('reject-next').addEventListener('click', () => load(game.tierKey, game.round + 1));
$('reset').addEventListener('click', () => { game.clear(); render(); });
$('restart').addEventListener('click', () => { restart(); });
$('check').addEventListener('click', renderStatus);
$('pause').addEventListener('click', () => setPaused(!motion.st.paused));
$('mute').addEventListener('click', () => setMuted(!audio.muted()));
$('fullscreen').addEventListener('click', () => { toggleFullscreen(); relayout(); });
$('help').addEventListener('click', () => toggleHelp());
$('hint').addEventListener('click', () => {
  if (!game.ok) return;
  const f = game.face, h = game.hint();
  $('hintline').textContent = h
    ? `提示：格 ${(h.i / f.w | 0) + 1},${(h.i % f.w) + 1} 应为${MARK_TEXT[h.v]} —— ${h.text}`
    : '铅笔在纯题面上已经没有"只剩一个选项"的一步可下了。这一盘的答案仍被裁判证明唯一，但要往下走就得试。';
});

// 方向键走格子；Enter/Space 与点击走同一条 cycle
$('board').addEventListener('keydown', (e) => {
  const el = e.target.closest('.cell');
  if (!el || !game.ok) return;
  audio.unlock();
  const r = Number(el.dataset.r), j = Number(el.dataset.j);
  const d = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] }[e.key];
  if (d) {
    e.preventDefault();
    const t = $('board').querySelector(`.cell[data-r="${r + d[0]}"][data-j="${j + d[1]}"]`);
    if (t) { t.tabIndex = 0; t.focus(); }
    return;
  }
  if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); applyMark(Number(el.dataset.i)); }
});

// 全局键：P/空格 暂停、R 重开、N 再来一局、M 静音、F 全屏、H/? 说明。
// 焦点在格子上时空格归"落子"（上面那条处理器已经 preventDefault，这里靠 defaultPrevented 让位）。
window.addEventListener('keydown', (e) => {
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  const k = e.key;
  const onCell = document.activeElement && document.activeElement.classList
    && document.activeElement.classList.contains('cell');
  if (k === ' ' && onCell) return;                    // 空格在格子上是落子，不是暂停
  const hit = {
    p: () => { setPaused(!motion.st.paused); },
    P: () => { setPaused(!motion.st.paused); },
    r: () => { restart(); }, R: () => { restart(); },
    n: () => { load(game.tierKey, game.round + 1); }, N: () => { load(game.tierKey, game.round + 1); },
    m: () => { setMuted(!audio.muted()); }, M: () => { setMuted(!audio.muted()); },
    f: () => { toggleFullscreen(); relayout(); }, F: () => { toggleFullscreen(); relayout(); },
    h: () => { toggleHelp(); }, H: () => { toggleHelp(); }, '?': () => { toggleHelp(); },
  }[k];
  if (!hit) return;
  e.preventDefault();
  hit();
});

// 指针：pointerdown 优先；没有 PointerEvent 的环境才接 touch/mouse 回落（两条通道不同时生效）。
if (window.PointerEvent) {
  $('board').addEventListener('pointerdown', onPointerDown);
  window.addEventListener('pointermove', onPointerMove);
  window.addEventListener('pointerup', endDrag);
  window.addEventListener('pointercancel', endDrag);
} else {
  $('board').addEventListener('touchstart', (e) => {
    const p = legacyPointFrom(e.targetTouches);
    if (p) onPointerDown({ ...p, button: 0, pointerType: 'touch', preventDefault: () => e.preventDefault() });
  }, { passive: false });
  $('board').addEventListener('touchmove', (e) => {
    const p = legacyPointFrom(e.targetTouches);
    if (p) onPointerMove({ ...p, buttons: 1 });
  }, { passive: true });
  window.addEventListener('touchend', endDrag);
  $('board').addEventListener('mousedown', (e) => {
    if (e.button === 2) return;
    onPointerDown({ ...e, pointerType: 'mouse', preventDefault: () => e.preventDefault() });
  });
  window.addEventListener('mousemove', (e) => { if (dragValue !== null) onPointerMove(e); });
  window.addEventListener('mouseup', endDrag);
  $('board').addEventListener('click', (e) => { if (!window.PointerEvent && e.detail === 0) applyMark(cellFromEvent(e)); });
}
// 右键只做两件事：黑 ↔ 未知（跳过"白"，注白交给左键的第二态）
$('board').addEventListener('contextmenu', (e) => {
  e.preventDefault();
  const i = cellFromEvent(e);
  if (i != null && game.canEdit(i)) applyMark(i, game.marks[i] === BLK ? UNK : BLK);
});

// ---------------------------------------------------------------- 布局与时钟
function relayout() {
  if (!fx || !game || !game.ok) return;
  fx.layout($('board'));
}
window.addEventListener('resize', relayout);
window.addEventListener('orientationchange', () => { relayout(); });
document.addEventListener('fullscreenchange', relayout);
if (typeof ResizeObserver !== 'undefined' && $('board')) new ResizeObserver(relayout).observe($('board'));

function frame(now) {
  const t = now / 1000;
  const dt = lastTime === null ? 0 : t - lastTime;    // 首帧 dt=0：不吃"页面打开前"的那段时间
  lastTime = t;
  motion.tick(dt);
  if (fx) fx.draw(motion, { RIPPLE_LIFE, SPARK_LIFE });
  if (!motion.st.paused) paintState(null);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// 换局号的来路有三种：按钮、地址栏手改、别的标签页 —— 后两种都靠 hashchange
window.addEventListener('hashchange', () => {
  const p = parseHash(location.hash);
  if (!p) {
    // 手改成一个不存在的档/局号（#nope/3、#easy-6x6/abc）：页面里没有这样一盘。
    // 按原状重发一次 load()，让地址栏回到真的那一局，而不是挂着一条页面对不上的 URL。
    load(game.tierKey, game.round);
    return;
  }
  if (p.tierKey !== game.tierKey || p.round !== game.round) load(p.tierKey, p.round);
});

/** 浏览器闸的读数口：状态由引擎派生，闸拿它与 node 侧逐字节对账。 */
window.tasquare = {
  state: () => (game ? {
    seed: game.seed, tier: game.tierKey, round: game.round, ok: game.ok,
    face: game.ok ? game.faceText() : null,
    counts: game.ok ? game.counts() : null,
    verdict: game.ok ? game.verdict() : null,
    hint: game.ok ? (game.hint() || null) : null,
    reject: game.ok ? null : game.reject.fail,
  } : null),
  mark: (i, v) => { game.mark(i, v); render(); },
  cycle: (i) => { game.cycle(i); render(); },
  load,
  pwa: () => ({ ...pwa }),
  // 时钟/动效/声音/暂停的读数：任何探针都能复验"这条通道真的在动"，而不是信一句注释。
  motion: () => motion.snapshot(),
  paused: () => motion.st.paused,
  setPaused,
  restart,
  muted: () => audio.muted(),
  setMuted,
  audio: () => audio.stats(),
  hit: (x, y) => (fx ? fx.hitCell(x, y) : null),
  geo: () => (fx ? fx.geo() : null),
  fullscreen: () => !!document.fullscreenElement,
  prefs: () => ({ ...prefs }),
};

// 装机通道：load 之后再注册（早于 load 会跟首屏资源抢同一条队列）。
// 注册结果只改 pwa 这一个状态位 —— 装不上机不影响玩，这条腿绝不能反过来拦页面。
window.addEventListener('load', () => {
  registerServiceWorker().then((s) => { pwa = s; });
});
