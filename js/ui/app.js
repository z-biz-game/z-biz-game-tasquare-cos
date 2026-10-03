// 页面装配 · 只画不判 —— 判定全部来自 js/ui/game.js 背后的引擎
//
// 纪律：本文件里不许出现"合法/唯一解/推得完"这类结论的**实现**，只许出现引擎答复的**转述**；
// 也不许在这里写死档位或规则文案：档名/尺寸/线索区间/步数区间从 TIERS 现读，
// 条款句子读 CLAUSE_TEXT，提示的"为什么"读 pencil.js 的 CLAUSES，出处引文读 SOURCE_QUOTE。

import { BLK, MARK_TEXT, UNK, WHT, cellsOf, makeGame, tierList } from './game.js';
import { CLAUSE_TEXT, DEFAULTS, SOURCE_QUOTE, SOURCE_URL } from '../engine/rules.js';

const $ = (id) => document.getElementById(id);
const tiers = tierList();
const store = typeof localStorage !== 'undefined' ? localStorage : null;

let game = null;

/** 局号是递增整数，**不许**由日期派生（那等于每天换一批盘，"换一局"就对不上任何公式）。 */
function parseHash(h) {
  const m = /^#?([0-9a-z._-]+)\/(\d+)$/i.exec(String(h || '').replace(/^#/, ''));
  if (!m) return null;
  return tiers.some((t) => t.key === m[1]) ? { tierKey: m[1], round: Number(m[2]) } : null;
}

function load(tierKey, round) {
  game = makeGame(tierKey, round, store);
  history.replaceState(null, '', `#${game.tierKey}/${game.round}`);   // 不触发 hashchange：换局只有一次 produce
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
}

function renderBoard() {
  const board = $('board');
  if (!game.ok) { board.innerHTML = ''; board.hidden = true; return; }
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
  for (const el of board.querySelectorAll('.free')) {
    const i = Number(el.dataset.i);
    el.addEventListener('click', () => { game.cycle(i); render(); });
    // 右键只做两件事：黑 ↔ 未知（跳过"白"，注白交给左键的第二态）
    el.addEventListener('contextmenu', (e) => { e.preventDefault(); game.mark(i, game.marks[i] === BLK ? UNK : BLK); render(); });
  }
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

renderStatic();
load((parseHash(location.hash) || { tierKey: tiers[0].key, round: 0 }).tierKey,
  (parseHash(location.hash) || { tierKey: tiers[0].key, round: 0 }).round);

$('next').addEventListener('click', () => load(game.tierKey, game.round + 1));
// 拒盘那块面板必须自己也能走人：#play 在这条分支里是 hidden 的，#next 根本点不到，
// 少这一行的话"这一局号没能出货"就是一张死路告示，而页面上唯一能换局的按钮藏在看不见的那块里。
$('reject-next').addEventListener('click', () => load(game.tierKey, game.round + 1));
// 走 restart() 而不是直接调 game.clear()：这两个在本仓是同一件事（理由见 game.js 里
// game.restart 的注释——marks 是这一局唯一能改的东西），但入口的名字要跟着玩家的
// 意图走：玩家要的是"这题我走错了，推倒重来"，不是"把我的黑块擦掉"。注释里那条
// "哪天加了撤销栈就必须同时点名"也是靠这个入口才守得住 —— 走 clear 就绕过去了。
$('reset').addEventListener('click', () => { game.restart(); render(); });
$('check').addEventListener('click', renderStatus);
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
  const r = Number(el.dataset.r), j = Number(el.dataset.j);
  const d = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] }[e.key];
  if (d) {
    e.preventDefault();
    const t = $('board').querySelector(`.cell[data-r="${r + d[0]}"][data-j="${j + d[1]}"]`);
    if (t) { t.tabIndex = 0; t.focus(); }
    return;
  }
  if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); game.cycle(Number(el.dataset.i)); render(); }
  // R 重开本题。本仓原先没有字母键（方向键走格、Enter/Space 落子），所以 R 是空的。
  // 局中就能按：玩家涂到一半发现这思路走不通，当场 R 一下原地重来。
  if (e.key === 'r' || e.key === 'R') { e.preventDefault(); game.restart(); render(); }
});

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
  // 供探针驱动：重开本题。挂在窗口上是为了让闸能真的调一次、读 BEFORE/AFTER，
  // 而不必去合成点击（格子的点击要落到 DOM 上，离屏闸点不稳）。
  restart: () => { game.restart(); render(); },
  load,
};

// ---- 全屏开关（#btn-fullscreen）----
// 绑的是本页 HUD 上真实存在的那个按钮。全屏最常见的假实现就是引用一个并不存在的
// id：点下去什么也不会发生，量具却算它"已实现"。所以这里找不到按钮就直接不装。
(function bindFullscreen() {
  const btn = document.getElementById('btn-fullscreen');
  if (!btn) return;
  const root = document.documentElement;
  // 只做特性检测，不嗅探 UA：iOS Safari 是 webkitRequestFullscreen，老 Edge 是 ms 前缀，
  // 而 UA 字符串随时会改。"有没有这个能力"是查出来的，不是猜出来的。
  const req = root.requestFullscreen || root.webkitRequestFullscreen || root.msRequestFullscreen;
  const exit = document.exitFullscreen || document.webkitExitFullscreen || document.msExitFullscreen;
  const current = () => document.fullscreenElement || document.webkitFullscreenElement
    || document.msFullscreenElement || null;

  // 不支持也要给个说法：只把按钮灰掉而不解释，玩家会以为这功能没做完。
  // supported 这枚标记不能省：下面 sync() 每次都会重写 title，不挡住的话，装的时候刚写
  // 进去的人话原因会被随后的 sync() 立刻抹成"全屏 (F)"——禁用就变成一句没有理由的禁用。
  let supported = !!req;
  const unsupported = () => {
    supported = false;
    btn.disabled = true;
    btn.title = '这个浏览器不提供元素全屏（iOS Safari 请用「添加到主屏幕」独立打开）';
  };
  if (!req) unsupported();

  // fullscreen 返回 Promise，被拒时必须吃掉：iOS Safari 对多数非 video 元素直接拒绝，
  // 让这个 rejection 冒泡出去会变成一条未捕获错误，整局游戏跟着挂。
  const settle = (p) => { if (p && p.catch) p.catch(unsupported); };

  // 进出都能走：已经全屏时这次调用是退出，不是"再进一次"。
  function toggle() {
    try {
      if (current()) {
        if (exit) settle(exit.call(document));
      } else if (req) {
        settle(req.call(root));
      } else {
        unsupported();
      }
    } catch (e) {
      unsupported();
    }
  }

  // Esc 和系统手势退出都不经过我们的代码，按钮状态只能靠 fullscreenchange 回写，
  // 否则用户已经退出、HUD 还停在"退出全屏"，下一次点击反而会重新进全屏。
  function sync() {
    const on = !!current();
    btn.setAttribute('aria-pressed', String(on));
    btn.textContent = on ? "退出全屏" : "全屏";
    if (supported) btn.title = "全屏" + '（F）';
    const body = document.body;
    if (body && body.classList) body.classList.toggle('fullscreen', on);
  }

  btn.addEventListener('click', toggle);
  window.addEventListener('keydown', (ev) => {
    if (ev.key !== 'f' && ev.key !== 'F') return;
    const t = ev.target;
    // 盘号 / 种子这类输入框里打字不能触发全屏，否则玩家输 seed 输到一半屏幕没了。
    if (t && /input|textarea|select/i.test(t.tagName || '')) return;
    if (ev.repeat || ev.metaKey || ev.ctrlKey || ev.altKey) return;
    ev.preventDefault();
    toggle();
  });
  window.addEventListener('fullscreenchange', sync);
  window.addEventListener('webkitfullscreenchange', sync);
  window.addEventListener('MSFullscreenChange', sync);
  sync();
})();
