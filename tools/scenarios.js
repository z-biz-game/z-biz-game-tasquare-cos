// 浏览器闸跑在页面里的场景：注入后由 tools/playtest.cjs 的 `scenario|interact <名>` 调 window.__scn.<名>()。
//
// 本回合十一条腿（简报的验收合同；verify.sh 的清单里每条都跑两种 URL 形态 ⇒ 共 22 段）：
//   · open        启动 + state().ok + 0 条 console 错误（SABOTAGE 时期望被改错 ⇒ 必红，自证不瞎）
//   · domint      DOM 完整性：格子数 / 谁 owning 哪段内容 / 线索圈的几何 / 网格轨道数
//   · playfull    纯题面铅笔账本 → window.tasquare.mark 全填 → 真指针点 检查 → #result/#cert/#violations
//   · illegal     同一张填满的盘把一枚黑格改白 → 真指针点 检查 → #result.bad + 逐条违反文字
//   · pointer     CDP 真指针点一格：unk→blk 且命中盒落回自己
//   · keyboard    CDP 真按键（Input.dispatchKeyEvent）：方向键走格 + Enter 落子 + 焦点活过重画
//   · narrow      窄屏腿：视口覆写发生在自己那次调用里，读回四对读数 + 两条互为反证的 matchMedia
//   · resume      跨**真刷新**（Page.reload）续玩：刷新前证人由 node 取走再送回来
//   · reject      自然拒盘局 #irr-8x8/0：#reject 展开、#play/#board 真收起、读屏文字擦干净、
//                 #reject-next 真指针连点两下到出货的那一局
//   · crossengine 4 档 × 5 局的题面逐字节对账（含自然拒盘的那几局），node 侧现算并比对 + 常量钉子
//   · canary      三条通道的负样本（自然拒盘 / 掐停出货预算 / 掐停探针预算）读数对账 + ms 闸结构证人
// 判定用的读数一律留在 stdout 里；墙上时钟那类（timeOrigin / 毫秒）以 `_` 前缀交回 —— 它们进
// .extra.json 供复验，但不进可 diff 的那条通道，否则"连跑两次逐字节相同"永远做不到。
//
// 规矩与兄弟仓同名同姓，内容是本仓自己的：
//   * 一条断言只写一次 `ck(名, 条件, 细节)`，机器可读的 `RESULT <json>` 由 playtest.cjs 打在 stdout
//     最后一行；一条断言都没发生的场景在 tools/verify.sh 里直接判红；
//   * **期望值来自 node**：题面条、铅笔账本、裁判读数、违反码全部由 `node tools/playtest.cjs
//     witness <tier> <round>` 现算（它 import 的就是浏览器加载的那批 js/ 模块），经 argv →
//     window.__expectRaw 传进来。页内不许自己"跟自己的上一版对表"，也不许把真解算出来再抄：
//     真值只以"要被扫掉的东西"这个身份进页面；
//   * 指针腿走 **CDP Input.dispatchMouseEvent**（tools/playtest.cjs 的 interact），页面只交坐标；
//     不用 element.click() —— 那等于没测命中盒与事件目标；键盘腿走 Input.dispatchKeyEvent；
//   * 题面条（face）= js/engine/rules.js 的 faceRows(face).join('/')，与 js/ui/game.js 的 faceText()
//     是同一条拼写 —— 只有逐字节比才钉得住跨引擎的 PRNG。
//
// 这一段跑在 js/ui/app.js **之前**（Page.addScriptToEvaluateOnNewDocument），所以启动期的未捕获异常
// 与资源 404 抓得到：那是"浏览器闸要抓的第一类 bug"，页面自己永远打印不出来。
((w) => {
  // ---------------------------------------------------------------- 探针：启动期的错与 404
  const PROBE = { js: [], res: [] };
  w.__probe = PROBE;
  w.addEventListener('error', (ev) => {
    const t = ev && ev.target;
    if (t && t !== w && (t.tagName || t.src || t.href)) {
      PROBE.res.push(`${t.tagName || 'node'}:${t.src || t.href || ''}`);
    } else {
      PROBE.js.push(String((ev && (ev.message || ev.error)) || 'error'));
    }
  }, true);
  w.addEventListener('unhandledrejection', (ev) => PROBE.js.push('rejection: ' + String(ev.reason)));
  const realError = w.console.error;
  w.console.error = function () {
    PROBE.js.push('[console.error] ' + [].map.call(arguments, String).join(' '));
    return realError.apply(this, arguments);
  };

  // ---------------------------------------------------------------- 断言小台
  const rows = [];
  const ck = (test, cond, detail) => {
    rows.push({ test, pass: !!cond, detail: cond ? '' : String(detail === undefined ? '' : detail) });
  };
  const eq = (test, got, want) => ck(test, String(got) === String(want), `got ${got} / want ${want}`);
  const report = (extra) => {
    const out = { rows: rows.slice(), fail: rows.filter((r) => !r.pass).length, ...extra };
    rows.length = 0;
    return out;
  };
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  /**
   * 把已经攒下的断言**交回 node 保管**并清空。续局腿非用不可：Page.reload 之后这是一个新文档，
   * 模块级 `rows` 数组跟着旧文档一起没了 —— 不交回来的话刷新前那一回合的断言就凭空蒸发，
   * tally 里只剩刷新后的读数，那条腿就变成"只验了后半截"。
   */
  const drain = () => { const o = { rows: rows.slice(), fail: rows.filter((r) => !r.pass).length }; rows.length = 0; return o; };
  const $ = (sel) => document.querySelector(sel);
  const T = () => w.tasquare;
  const S = () => (w.tasquare ? w.tasquare.state() : null);
  const text = (node) => ((node || {}).textContent || '');
  const html = (node) => ((node || {}).innerHTML || '');
  const exp = () => JSON.parse(w.__expectRaw || 'null');
  const faceOf = (E) => String(E.face).split('/').map((r) => r.split(' '));   // 期望题面（node 侧串）

  /**
   * 动态 import 必须按 document.baseURI 解析：Pages 把本仓挂在 /<repo>/ 下，斜杠开头的说明符会解到
   * 域名根上 404（本地"根形态"跑起来一切正常 —— 最坏的那种绿）。
   */
  const mod = (rel) => import(new URL(rel, document.baseURI).href);

  const shown = (node) => {
    const e = typeof node === 'string' ? $(node) : node;
    if (!e) return false;
    return getComputedStyle(e).display !== 'none' && e.getClientRects().length > 0;
  };
  /** [hidden] 必须真收起来：本仓 css 头一条就是它，#play 自带 display:grid 会盖过 UA 那条。 */
  const hiddenTight = (node) => {
    const e = typeof node === 'string' ? $(node) : node;
    return !!e && e.hidden && getComputedStyle(e).display === 'none' && e.getClientRects().length === 0;
  };
  const whyNotTight = (node) => {
    const e = typeof node === 'string' ? $(node) : node;
    if (!e) return '节点不存在';
    return `hidden=${e.hidden} display=${getComputedStyle(e).display} rects=${e.getClientRects().length}`;
  };
  /** 命中盒：中心点在视口内、且 elementFromPoint 落回自己（或自己的后代）。 */
  const hitSelf = (el) => {
    if (!el) return '控件不存在';
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) return '零尺寸';
    const x = r.left + r.width / 2;
    const y = r.top + r.height / 2;
    if (x < 0 || y < 0 || x > w.innerWidth + 0.5 || y > w.innerHeight + 0.5) {
      return `中心在视口外 ${Math.round(x)},${Math.round(y)}（视口 ${w.innerWidth}×${w.innerHeight}）`;
    }
    const hit = document.elementFromPoint(x, y);
    if (hit === el || el.contains(hit) || (hit && hit.contains(el))) return '';
    return `中心被 ${hit ? (hit.id || hit.className || hit.tagName) : 'nothing'} 盖住`;
  };
  /** 该藏起来的东西不能被命中到：elementFromPoint 落在它身上 = 只是"看不见"却还能点。 */
  const unhittable = (el) => {
    if (!el) return '节点不存在';
    const r = el.getBoundingClientRect();
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return hit === el || el.contains(hit) ? `elementFromPoint 还能命中它（${hit.tagName}）` : '';
  };
  /** 量中心点之前先把它滚进第一屏：坐标交回 node 去点，点不到屏幕外的东西不是页面的错。 */
  const centerOf = (el) => {
    if (el && el.scrollIntoView) el.scrollIntoView({ block: 'center', inline: 'nearest' });
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  };
  const cellEl = (i) => document.querySelector(`#board .cell[data-i="${i}"]`);
  const classes = (el) => (el ? String(el.className) : '<无节点>');
  /** 腿内自带前置：本仓的档是按 `tasquare:v1:<档>:<局>` 存的，同形态一个 profile 共用一套。 */
  const wipeSaves = () => {
    for (const k of Object.keys(localStorage).filter((x) => x.indexOf('tasquare:') === 0)) localStorage.removeItem(k);
    return Object.keys(localStorage).filter((x) => x.indexOf('tasquare:') === 0).length;
  };
  /** 清档 + 重开那一局：produces 同一张题面（seed 是纯函数），marks 回到全未知。 */
  const loadClean = async (tier, round) => {
    wipeSaves();
    T().load(tier, round);
    await wait(0);
    return S();
  };
  const applyLedger = (E, skip) => {
    let n = 0;
    for (const x of E.ledger) { if (skip != null && x.i === skip) continue; T().mark(x.i, x.v); n++; }
    return n;
  };

  // ================================================================ 腿 1 · open
  const open = async () => {
    const E = exp();
    ck('期望值由 node 侧证人交回（witness 那一腿起不来就必须红）', !!E && E.tier !== undefined, w.__expectRaw);
    if (!E) return report({ href: location.href });
    // 阴性自证（SABOTAGE=1 ⇒ verify.sh 把 okWant 写成 false）：这一条**必须**红，
    // 一条永远同意的 open 等于没看页面。
    const okWant = E.okWant === undefined ? true : E.okWant === true;
    ck('window.tasquare 在场且 state().ok 与期望一致（SABOTAGE 时期望被改错 ⇒ 这条红）',
      !!T() && !!S() && (S().ok === okWant), `实测 ok=${S() && S().ok} 期望 ok=${okWant}`);
    ck('启动期没有未捕获异常 / 资源 404 / console.error（含说明符解不开这种 import）',
      PROBE.js.length === 0 && PROBE.res.length === 0, JSON.stringify(PROBE).slice(0, 420));
    const st = S();
    if (!st) return report({ href: location.href, probe: PROBE });
    eq('档位与局号 = 期望那一张（首屏由 #档位/局号 或默认决定）', `${st.tier}/${st.round}`, `${E.tier}/${E.round}`);
    eq('seed 串形状 tasquare|档位|局号', st.seed, E.seed);
    eq('题面条逐字节 = node 侧（页面画的就是引擎算的那张）', st.face, E.face);
    ck('state() 交回的动词表齐（state/mark/cycle/load 四个，没有第五个判定的口子）',
      ['state', 'mark', 'cycle', 'load'].every((k) => typeof T()[k] === 'function'), Object.keys(T()).join(','));
    const drawn = document.querySelectorAll('#board .cell').length;
    ck(`#board 画上 ${E.n} 格（${E.freeCells} 自由 + ${E.clueCells} 线索，格数由 node 侧 h×w 定）`,
      drawn === E.n && st.counts.free === E.freeCells,
      `实画 ${drawn}/${E.n} 格 · 自由格 ${st.counts.free}/${E.freeCells}`);
    const tiers = document.querySelectorAll('#tiers .tier');
    ck('档位导航按 TIERS 现读（4 个按钮，页面里没有第二份档名表）', tiers.length === 4, `${tiers.length} 个`);
    ck(`规则面板的条款由 CLAUSE_TEXT 现读（${E.clauses.length} 条一条一号，页里没有第二份条款表）`,
      document.querySelectorAll('#clauses li').length === E.clauses.length,
      `${document.querySelectorAll('#clauses li').length} 条 vs node ${E.clauses.length} 条`);
    // 起步一格没涂：未知数必须等于 node 侧数出的**自由格数**（拿 state 自己比自己是同义反复，抓不到东西）
    eq('起步一格没涂（未知数 = node 侧自由格数）', `${st.counts.unknown}/${st.counts.free}`,
      `${E.freeCells}/${E.freeCells}`);
    ck('#play 展开、#reject 是**真**隐藏（[hidden] 没被自带 display:grid 盖过去）',
      shown('#play') && hiddenTight('#reject'), `${whyNotTight('#reject')}`);
    return report({
      href: location.href, baseURI: document.baseURI, tier: st.tier, round: st.round, seed: st.seed,
      ok: st.ok, faceBytes: String(st.face).length, counts: st.counts,
      consoleErrors: PROBE.js.length + PROBE.res.length, okWant,
      _timeOrigin: String(performance.timeOrigin),
    });
  };

  // ================================================================ 腿 2 · dom-integrity
  /**
   * 这一条网的由来（不许删）：cell 模板里那个**没闭合的属性引号**曾经让解析器把后面每一个
   * `.cell` 都吞进同一个属性里 —— 36 格只剩 18 格，而少掉的那 18 格的内容被交给了**别的格子**。
   * 只看"页面没报错"、只数"有格子"都抓不到它：所以这条腿必须**既数格子数、又核对每一格 owning 的内容**，
   * 两者同一条腿里做，缺一网就漏。
   */
  const domint = async () => {
    const E = exp();
    ck('dom-integrity 的期望题面由 node 证人交回', !!E && !!E.face, String(w.__expectRaw).slice(0, 160));
    if (!E || !E.face) return report({ href: location.href });
    const st = S();
    if (!st) { ck('页面有 state() 读数', false, 'state() 为空'); return report({ href: location.href }); }
    const tokens = faceOf(E);
    const cells = Array.from(document.querySelectorAll('.cell'));
    ck(`${cells.length}/${E.h * E.w} 个 .cell 节点（盘画全了才谈得上"谁 owning 哪段内容"）`,
      cells.length > 0 && cells.length === E.h * E.w, `${cells.length}/${E.h * E.w}`);
    const freeCells = cells.filter((el) => el.classList.contains('free'));
    const clueCells = cells.filter((el) => el.classList.contains('clue'));
    const freeBad = freeCells.filter((el) => el.textContent !== '');
    ck(`${freeCells.length - freeBad.length}/${freeCells.length} 个 .cell.free 的 textContent 是空的（空格不写字）`,
      freeCells.length === E.freeCells && freeBad.length === 0,
      freeBad.slice(0, 4).map((el) => `${el.dataset.i}:「${el.textContent}」`).join(' '));
    const spanBad = [];
    const ownBad = [];
    for (const el of clueCells) {
      const i = Number(el.dataset.i);
      const want = tokens[Math.floor(i / E.w)][i % E.w];
      const spans = el.querySelectorAll('span');
      if (spans.length !== 1) { spanBad.push(`${i}:${spans.length} 个 span`); continue; }
      if (spans[0].textContent !== want) ownBad.push(`${i}:屏上「${spans[0].textContent}」题面「${want}」`);
    }
    ck(`${clueCells.length - spanBad.length}/${clueCells.length} 个 .cell.clue 恰有一个 span`,
      spanBad.length === 0, spanBad.slice(0, 4).join(' '));
    ck(`${clueCells.length - ownBad.length}/${clueCells.length} 个线索格的 span 文字 = **它自己那一格**的题面读数`,
      clueCells.length === E.clueCells && ownBad.length === 0, ownBad.slice(0, 4).join(' '));
    const tracks = getComputedStyle($('#board')).gridTemplateColumns.split(' ').filter(Boolean).length;
    eq('#board 的 grid-template-columns 轨道数 = 档位的 w', tracks, E.w);
    const numClue = clueCells.filter((el) => !el.classList.contains('q'));
    const qClue = clueCells.filter((el) => el.classList.contains('q'));
    const circleBad = [];
    for (const el of numClue) {
      const s = el.querySelector('span');
      const cs = getComputedStyle(s);
      const bw = parseFloat(cs.borderTopWidth) || 0;
      const br = cs.borderRadius;
      if (!(bw > 0) || !(br === '50%' || parseFloat(br) >= Math.min(s.offsetWidth, s.offsetHeight) / 2 - 0.5)) {
        circleBad.push(`${el.dataset.i}:borderWidth ${bw} radius ${br}`);
      }
    }
    ck(`${numClue.length - circleBad.length}/${numClue.length} 个数字线索的 span 是**真的圆**（borderWidth>0 且 radius 50%）`,
      numClue.length > 0 && circleBad.length === 0, circleBad.slice(0, 4).join(' '));
    ck(`问号线索不带圈（源文本如此）：${qClue.length} 个问号格的 span borderWidth 全为 0`,
      qClue.every((el) => parseFloat(getComputedStyle(el.querySelector('span')).borderTopWidth) === 0),
      `${qClue.length} 个问号格 · 数字格 ${numClue.length}`);
    eq('线索格数 = node 侧（印刷条数不是页面临时算的）', clueCells.length, E.clueCells);
    const readonlyBad = clueCells.filter((el) => el.getAttribute('aria-readonly') !== 'true' || el.hasAttribute('tabindex'));
    ck(`${clueCells.length - readonlyBad.length}/${clueCells.length} 个线索格带 aria-readonly 且没有 tabindex（题面不可下子）`,
      readonlyBad.length === 0, readonlyBad.slice(0, 4).map((el) => el.dataset.i).join(' '));
    const dataBad = cells.filter((el) => {
      const i = Number(el.dataset.i);
      return el.dataset.r !== String(Math.floor(i / E.w)) || el.dataset.j !== String(i % E.w);
    });
    ck(`${cells.length - dataBad.length}/${cells.length} 格的 data-i/r/j 三者自洽（行主序没写串）`,
      dataBad.length === 0, dataBad.slice(0, 4).map((el) => `${el.dataset.i}:${el.dataset.r},${el.dataset.j}`).join(' '));
    return report({
      cells: `${cells.length}/${E.h * E.w}`, free: `${freeCells.length - freeBad.length}/${freeCells.length}`,
      clues: `${clueCells.length - ownBad.length}/${clueCells.length}`, tracks,
      circles: `${numClue.length - circleBad.length}/${numClue.length}`, qmarks: qClue.length,
      tier: st.tier, round: st.round, href: location.href,
    });
  };

  // ================================================================ 腿 3 · playthrough
  /**
   * 填盘走 window.tasquare.mark（引擎动词），"检查"那颗钮走 CDP 真指针 —— 判定结果读的是 DOM，
   * 不是 state()：屏上说的话才是玩家听到的那句话。#cert 那串数字**解析出来**与 node 侧逐个数对，
   * 不做"包含 count=1 就算过"那种松匹配。
   */
  const RESULT_WON = '完成：这张涂黑过规则模型的全部条款';   // 页面那句话的**唯一**出处是 js/ui/app.js，
  //                                       引擎里没有第二个常量可抄；文字漂了这条就该红（钉死，不是宽容）。
  const parseCert = (t) => {
    const g = (re) => { const m = re.exec(t); return m ? m[1] : null; };
    return {
      parsed: !!t && /count=/.test(t) && /stopped=/.test(t) && /差 \d+ 格/.test(t),
      count: g(/count=(-?\d+)/), nodes: g(/节点 (\d+)/), stopped: g(/stopped=(true|false)/),
      clues: g(/线索 (\d+) 条/), steps: g(/铅笔 (\d+) 步/), unknown: g(/未知 (\d+)/),
      rules: g(/命中规则 (\d+) 条/), diff: g(/差 (\d+) 格/),
    };
  };
  const playfull = async (ctx) => {
    const round = (ctx && ctx.round) || 0;
    const E = exp();
    if (!E || !E.ok) { ck('playthrough 的期望（题面与账本）由 node 证人交回', false, String(w.__expectRaw).slice(0, 160)); return report(); }
    if (round === 0) {
      const st = await loadClean(E.tier, E.round);
      ck('起步这张盘一格没涂（未知 = 自由格数）',
        st.counts.unknown === E.freeCells && st.counts.black === 0,
        `未知 ${st.counts.unknown} / 自由 ${E.freeCells} · 黑 ${st.counts.black}`);
      const n = applyLedger(E);
      ck(`铅笔账本的 ${n}/${E.ledger.length} 步全部由 window.tasquare.mark 落子（账本出处 = node 侧）`,
        n === E.ledger.length && E.ledger.length > 0, `${n} vs ${E.ledger.length}`);
      const st2 = S();
      ck(`落子后填满：黑 ${st2.counts.black}/${E.blacks.length} · 白 ${st2.counts.white}/${E.whites} · 未知 ${st2.counts.unknown}/0`,
        st2.counts.black === E.blacks.length && st2.counts.white === E.whites && st2.counts.unknown === 0,
        JSON.stringify(st2.counts));
      const clsBad = [];
      for (const x of E.ledger) {
        const el = cellEl(x.i);
        const want = x.v === 1 ? 'blk' : 'wht';
        if (!el || !el.classList.contains(want)) clsBad.push(`${x.i}:${classes(el)}`);
      }
      ck(`${E.ledger.length - clsBad.length}/${E.ledger.length} 格的 class 写着账本说的那个态（屏上不是影子）`,
        clsBad.length === 0, clsBad.slice(0, 4).join(' '));
      ck('state().verdict 满了且合法（引擎那一侧同样说它过条款）',
        S().verdict.full === true && S().verdict.legal === true && S().verdict.violations.length === 0,
        JSON.stringify(S().verdict).slice(0, 200));
      return { pending: [centerOf($('#check'))], stage: 'check', marks: n };
    }
    const c = parseCert(text($('#cert')));
    ck('#cert 那串数字解析得开（文案漂了就红，不许静默少断言）', c.parsed, JSON.stringify(c));
    ck('#result 的 class 含 won 且写着完成那句原话',
      $('#result').classList.contains('won') && text($('#result')) === RESULT_WON,
      `class="${classes($('#result'))}" 文字「${text($('#result'))}」`);
    const want = E.cert;
    eq('凭证 count = node 侧现数（不是抄出货凭证）', c.count, want.count);
    eq('凭证 节点数 = node 侧同一份 countSolutions 的读数', c.nodes, want.nodes);
    eq('凭证 stopped = false（撞预算不是读数）', c.stopped, String(want.stopped));
    eq('凭证 线索条数 = node 侧', c.clues, want.clues);
    eq('凭证 铅笔步数 = node 侧', c.steps, want.pencilSteps);
    eq('凭证 未知数 = 0', c.unknown, want.pencilUnknown);
    eq('凭证 命中规则条数 = node 侧', c.rules, want.rules);
    ck('#cert 含 count=1 与 stopped=false 与「差 0 格」（人读的那三处字样也在）',
      text($('#cert')).indexOf('count=1') > 0 && text($('#cert')).indexOf('stopped=false') > 0 &&
      text($('#cert')).indexOf('差 0 格') > 0, text($('#cert')).slice(0, 260));
    ck(`#cert 写着「差 ${want.vsPlayer} 格」：玩家这张与裁判那张逐格相同`, c.diff === String(want.vsPlayer),
      `实测差 ${c.diff} 格 / 期望 ${want.vsPlayer}`);
    const lis = document.querySelectorAll('#violations li');
    ck('#violations 是空的（合法盘不给报错）', lis.length === 0, `${lis.length} 条`);
    ck('#hintline 没被点上一步提示（零猜测这条腿不靠提示）', text($('#hintline')) === '', text($('#hintline')).slice(0, 80));
    const st = S();
    return report({
      tier: st.tier, round: st.round, marks: E.ledger.length, blacks: st.counts.black, whites: st.counts.white,
      cert: c, certWant: want, result: text($('#result')).slice(0, 40), violations: lis.length, href: location.href,
    });
  };

  // ================================================================ 腿 4 · illegal-full
  const illegal = async (ctx) => {
    const round = (ctx && ctx.round) || 0;
    const E = exp();
    if (!E || !E.ok || !E.illegal) { ck('illegal 的期望（题面、账本与违反码表）由 node 证人交回', false, String(w.__expectRaw).slice(0, 160)); return report(); }
    if (round === 0) {
      await loadClean(E.tier, E.round);
      const n = applyLedger(E, E.illegal.i);
      const done = n + 1;
      T().mark(E.illegal.i, 2);                                  // 把 node 点名的那枚黑格改成**白**
      const st = S();
      ck(`填满 ${done}/${E.freeCells} 格且**只有**格 ${E.illegal.i} 被改白（黑 ${st.counts.black} 期望 ${E.blacks.length - 1}）`,
        st.counts.unknown === 0 && st.counts.black === E.blacks.length - 1, JSON.stringify(st.counts));
      ck('改白之前先证一遍：这一格在账本里原本是黑',
        E.ledger.some((x) => x.i === E.illegal.i && x.v === 1), JSON.stringify(E.ledger.slice(0, 3)));
      return { pending: [centerOf($('#check'))], stage: 'check', marks: done };
    }
    const want = E.illegal;
    const lis = Array.from(document.querySelectorAll('#violations li'));
    ck(`非空底线：#violations 实得 ${lis.length} 条 li（期望 ${want.codes.length}）`,
      lis.length >= 1 && lis.length === want.codes.length, `实得 ${lis.length} · 期望 ${want.codes.length}`);
    ck('#result 的 class 含 bad 且不含 won（一张不合条款的盘不许同时说两句话）',
      $('#result').classList.contains('bad') && !$('#result').classList.contains('won'), classes($('#result')));
    ck('#result 写着"填满了，但有 n 处不合条款"且 n = li 条数',
      /^填满了，但有 (\d+) 处不合条款$/.test(text($('#result')).trim()) &&
      Number(/^填满了，但有 (\d+) 处不合条款$/.exec(text($('#result')).trim())[1]) === lis.length,
      text($('#result')));
    const got = [];
    const bad = [];
    for (const li of lis) {
      const b = li.querySelector('b');
      const t = b ? b.textContent : '';
      got.push(t.slice(0, 3));
      if (!/^\[R/.test(t)) bad.push(`不是 [R 开头：「${t}」`);
    }
    const rules = await mod('./js/engine/rules.js');
    const table = Object.values(rules.CLAUSE_TEXT);
    const notVerbatim = lis.filter((li) => {
      const b = li.querySelector('b');
      return !b || table.indexOf(b.textContent) < 0;
    });
    ck(`${lis.length - notVerbatim.length}/${lis.length} 条违反文字逐字 = CLAUSE_TEXT 的某一条`,
      notVerbatim.length === 0, notVerbatim.slice(0, 3).map((li) => `「${(li.querySelector('b') || {}).textContent}」`).join(' '));
    ck('页面 import 的 rules.js 条款表与 node 证人交回的那份逐字相同（跨引擎同一份文字）',
      JSON.stringify(table) === JSON.stringify(E.clauses), `${table.length} 条 vs ${E.clauses.length} 条`);
    ck(`每条 li 的代号都以 [R 起头（实得 ${got.join(' ')}）`, bad.length === 0 && got.length > 0, bad.slice(0, 3).join(' '));
    const codes = lis.map((li) => { const b = li.querySelector('b'); return b ? b.textContent.slice(1, 3) : '?'; });
    ck(`违反码集合与 node 侧同一个 verify() 的结果相符：${codes.sort().join(',')} vs ${want.codes.slice().sort().join(',')}`,
      codes.slice().sort().join(',') === want.codes.slice().sort().join(','), `页 ${codes.join(',')} · node ${want.codes.join(',')}`);
    ck('#cert 是空的（没过的盘不许发凭证）', text($('#cert')) === '', text($('#cert')).slice(0, 120));
    ck('#violations 的每条都带着 msg（<code> 那段人读的坐标出处在）',
      lis.every((li) => { const x = li.querySelector('code'); return x && /^R\d/.test(x.textContent); }),
      lis.map((li) => (li.querySelector('code') || {}).textContent).slice(0, 3).join(' '));
    const st = S();
    return report({
      tier: st.tier, round: st.round, nViol: lis.length, wantViol: want.codes.length,
      codes, flipped: E.illegal.i, result: text($('#result')).slice(0, 40), cert: text($('#cert')).length,
      href: location.href,
    });
  };

  // ================================================================ 腿 5 · pointer
  const pointer = async (ctx) => {
    const round = (ctx && ctx.round) || 0;
    const E = exp();
    if (!E || !E.ok) { ck('指针腿的期望由 node 证人交回', false, String(w.__expectRaw).slice(0, 160)); return report(); }
    if (round === 0) {
      const st = await loadClean(E.tier, E.round);
      ck(`起步格 ${E.ptrCell} 是自由格且当前 unk`, !!cellEl(E.ptrCell) && cellEl(E.ptrCell).classList.contains('unk'),
        classes(cellEl(E.ptrCell)));
      ck('藏起来的 #reject 点不到（elementFromPoint 不落在它身上）',
        [$('#reject')].every((el) => unhittable(el) === ''), [$('#reject')].map(unhittable).filter(Boolean).join(' · '));
      const c = centerOf(cellEl(E.ptrCell));
      const hit = document.elementFromPoint(c.x, c.y);
      ck(`量到的中心点 ${Math.round(c.x)},${Math.round(c.y)} 的 elementFromPoint 落回**这一格**（或其后代）`,
        hit === cellEl(E.ptrCell) || cellEl(E.ptrCell).contains(hit),
        hit ? `命中 ${hit.tagName}.${hit.className || hit.id}` : 'null');
      ck(`起步盘面全 unk：${st.counts.unknown}/${E.freeCells}`, st.counts.unknown === E.freeCells, `${st.counts.unknown}`);
      PTR_POS = c;
      return { pending: [{ x: c.x, y: c.y }], stage: 'cycle', cell: E.ptrCell };
    }
    const el = cellEl(E.ptrCell);
    const st = S();
    ck(`真指针点过之后格 ${E.ptrCell} 的 class 是 blk（unk→blk 一次循环，没有第二跳）`,
      !!el && el.classList.contains('blk') && !el.classList.contains('unk'), classes(el));
    ck(`黑子计数 1/1：counts.black=${st.counts.black} · 未知 ${st.counts.unknown}/${E.freeCells - 1}`,
      st.counts.black === 1 && st.counts.unknown === E.freeCells - 1, JSON.stringify(st.counts));
    const hit = document.elementFromPoint(PTR_POS ? PTR_POS.x : 0, PTR_POS ? PTR_POS.y : 0);
    ck('重画之后**同一坐标**的命中盒仍落在这一格上（节点换了，格子没换位置）',
      !!el && (hit === el || el.contains(hit)), hit ? `命中 ${hit.tagName}.${hit.className || hit.id}` : 'null');
    ck('aria-label 跟着换态（读屏说的与 class 是同一件事）',
      !!el && /当前黑/.test(el.getAttribute('aria-label') || ''), el ? el.getAttribute('aria-label') : '无节点');
    const out = report({
      tier: st.tier, round: st.round, cell: E.ptrCell, click: PTR_POS ? `${Math.round(PTR_POS.x)},${Math.round(PTR_POS.y)}` : null,
      cls: classes(el), counts: st.counts, href: location.href,
    });
    PTR_POS = null;
    return out;
  };
  let PTR_POS = null;

  // ================================================================ 腿 6 · keyboard
  /**
   * 唯一写盘通道是 CDP 派进来的键：页内一个 tasquare.mark()/cycle() 都不许调
   * （loadClean 是**开局**动词，与被测的按键通道无关）。
   *  recorder 是 window 上的第二个 keydown 监听：注册时机在 js/ui/app.js 之后 ⇒ 同一次派发里它跑在
   * 页面处理器**之后**，抄到的是"派发跟着焦点走"的现场证据（ev.target / isTrusted / defaultPrevented）。
   */
  const KLOG = [];
  const installKeyRecorder = () => {
    if (w.__kbRecorder) return;
    w.__kbRecorder = true;
    w.addEventListener('keydown', (ev) => {
      const ae = document.activeElement || {};
      const et = ev.target || {};
      KLOG.push({
        key: ev.key, trusted: ev.isTrusted, dp: ev.defaultPrevented,
        // ev.target = 浏览器**派发那一刻**的目标（焦点在哪一格由 Chrome 决定，改不了）；
        // activeElement 是页面处理器跑完之后的读数 —— 两个都要抄，否则"方向键把焦点送去右邻"
        // 这一条会拿"处理之后"的值去断"派发之时"的格子，红得莫名其妙。
        tgt: `${et.tagName || '?'}[data-i=${et.dataset ? et.dataset.i : 'none'}]`,
        evI: et.dataset && et.dataset.i !== undefined ? Number(et.dataset.i) : -1,
        aeI: ae.dataset && ae.dataset.i !== undefined ? Number(ae.dataset.i) : -1,
      });
    });
  };
  let KB_POS = null;
  const keyboard = async (ctx) => {
    const round = (ctx && ctx.round) || 0;
    const E = exp();
    if (!E || !E.ok) { ck('键盘腿的期望由 node 证人交回', false, String(w.__expectRaw).slice(0, 160)); return report(); }
    installKeyRecorder();
    if (round === 0) {
      const st = await loadClean(E.tier, E.round);
      ck('键盘腿起步一格没涂', st.counts.unknown === E.freeCells, `${st.counts.unknown}/${E.freeCells}`);
      const startEl = cellEl(E.kb.start);
      ck(`起点格 ${E.kb.start} 与其右邻格 ${E.kb.right} 都是自由格（期望由题面算，不是抄读数）`,
        !!startEl && !!cellEl(E.kb.right) && startEl.classList.contains('free') && cellEl(E.kb.right).classList.contains('free'),
        `${classes(startEl)} | ${classes(cellEl(E.kb.right))}`);
      if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
      startEl.focus({ preventScroll: true });
      const ae = document.activeElement;
      ck('焦点被**显式**钉在起点格并读回（派发之前先证明 activeElement 是谁）',
        ae === startEl && Number(ae.dataset.i) === E.kb.start,
        `${ae.tagName}#${ae.id || ''} data-i=${ae.dataset ? ae.dataset.i : 'none'}`);
      KB_POS = { start: E.kb.start, right: E.kb.right, pinned: String(ae.dataset && ae.dataset.i) };
      KLOG.length = 0;                                 // 钉焦点不算派发：把可能的噪声清空
      return { pendingKeys: [{ key: 'ArrowRight' }, { key: 'Enter' }], stage: 'move+enter' };
    }
    const want = E.kb;
    const got = KLOG.splice(0, KLOG.length);
    ck(`keyHits ${got.length}/${2}（页内抄到的 keydown 数 = 派发数；n 必须 >0 才算这条腿跑过）`,
      got.length === 2 && got.length > 0, `实得 ${got.length}`);
    ck('两次派发都是浏览器真事件（isTrusted=true）且都被页面 preventDefault',
      got.length === 2 && got.every((g) => g.trusted === true && g.dp === true), JSON.stringify(got));
    ck(`第 0 键 ArrowRight 的派发目标（ev.target）就是起点格 ${want.start}`,
      got[0] && got[0].evI === want.start, got[0] ? `实测 evI=${got[0].evI} ${got[0].tgt}` : '无读数');
    ck(`第 1 键 Enter 的派发目标已经是右邻格 ${want.right}（方向键真的把焦点送过去了）`,
      got[1] && got[1].evI === want.right, got[1] ? `实测 evI=${got[1].evI} ${got[1].tgt}` : '无读数');
    ck(`处理器跑完之后的读数：第 0 键之后 activeElement 落在 ${want.right} · 第 1 键之后仍在 ${want.right}`,
      got.length === 2 && got[0].aeI === want.right && got[1].aeI === want.right,
      JSON.stringify(got.map((g) => [g.evI, g.aeI])));
    const ae = document.activeElement;
    const liveRight = cellEl(want.right);
    ck(`Enter 之后焦点仍在格 ${want.right} 并**活过整块 innerHTML 重画**（render() 按 data-i 找回来了；这条是本仓刚修的真 bug）`,
      !!liveRight && ae === liveRight && Number(ae.dataset.i) === want.right,
      `activeElement=${ae.tagName}#${ae.id || ''} data-i=${ae.dataset ? ae.dataset.i : 'none'} · 现量节点 data-i=${liveRight ? liveRight.dataset.i : 'gone'}`);
    ck(`那一格的 class 由 unk 变 blk（键盘通道落的子）`,
      !!liveRight && liveRight.classList.contains('blk'), classes(liveRight));
    const st = S();
    ck(`盘面读数：黑 1/${st.counts.black} · 起点格没被动过（仍是 unk）`,
      st.counts.black === 1 && !!cellEl(want.start) && cellEl(want.start).classList.contains('unk'),
      `${JSON.stringify(st.counts)} · 起点 ${classes(cellEl(want.start))}`);
    const saveKey = `tasquare:v1:${st.tier}:${st.round}`;
    ck(`存档键 ${saveKey} 已落盘（键盘写的手确实进 localStorage，不是只活在内存里）`,
      Object.keys(localStorage).includes(saveKey), JSON.stringify(Object.keys(localStorage)));
    const out = report({
      tier: st.tier, round: st.round, keyHits: `${got.length}/2`, start: want.start, right: want.right,
      focusBeforePin: null, focusPinned: KB_POS ? KB_POS.pinned : null, focusAfter: ae.dataset ? ae.dataset.i : null,
      counts: st.counts, targets: got.map((g) => g.tgt), href: location.href,
    });
    KB_POS = null;
    return out;
  };

  // ================================================================ 腿 7 · narrow
  /**
   * 这一腿存在的理由是这个家族踩过的那颗假绿：先起一个进程设 Emulation.setDeviceMetricsOverride 就退出，
   * 再另起进程跑场景 ⇒ 跑断言的那个进程从没被覆写，在 vw 1280 下把桌面断言又跑一遍。
   * 所以三条缺一不可：① 覆写发生在这一腿自己的调用里（attach 后、导航前、同一 session）；
   * ② 腿内把 vw/vh/dpr/#board.clientWidth **读回来当断言**；③ 断言本身是窄屏形状（重排证人 + 逐格命中盒）。
   * **farm 口径：不许对 mobile 标志本身下任何断言**（它可证明地改不动任何读数）；
   * 覆写的证人只有那四对读数与两条互为反证的 matchMedia。
   */
  const narrow = async () => {
    const E = exp();
    ck('窄屏腿的期望（出货盘 + 请求的视口三元组）由 node 侧带进来（缺了就必须红）',
      !!E && !!E.face && Number.isInteger(E.vwWant) && Number.isInteger(E.dprWant), String(w.__expectRaw).slice(0, 160));
    if (!E || !E.face) return report({ href: location.href });
    const W = E.vwWant, Hh = E.vhWant, Dp = E.dprWant;
    const vw = w.innerWidth, vh = w.innerHeight, dpr = w.devicePixelRatio;
    const board = $('#board');
    const bcw = board ? board.clientWidth : -1;
    eq(`覆写证人 1/4 innerWidth = 请求的 ${W}（桌面腿读到的是 Chrome 窗口宽 1280）`, vw, W);
    eq(`覆写证人 2/4 devicePixelRatio = 请求的 dpr ${Dp}`, dpr, Dp);
    eq(`覆写证人 3/4 innerHeight = 请求的 ${Hh}`, vh, Hh);
    ck(`覆写证人 4/4 #board.clientWidth 是个真读数（${bcw} > 0，窄屏下盘确实被画出来了）`, bcw > 0, `${bcw}`);
    ck('请求的不是桌面那一对（W≠1280 或 D≠1）—— 否则这条腿就是在重跑桌面断言',
      W !== 1280 || Dp !== 1, `请求 ${W}×${Hh}×${Dp}`);
    const mq = (q) => w.matchMedia(q).matches;
    eq('窄屏 query (max-width: 720px) 命中（样式真的按窄屏那套在算）', mq('(max-width: 720px)'), 'true');
    eq('桌面 query (min-width: 721px) 不命中（同一句话在桌面配置上是反的 ⇒ 两条互为反证）', mq('(min-width: 721px)'), 'false');
    const st = S();
    ck(`起步就是最宽那一档（${E.tier}/${E.round} · 横向溢出风险最大）`, !!st && st.tier === E.tier && st.round === E.round,
      st ? `${st.tier}/${st.round}` : 'state() 为空');
    if (!st) return report({ href: location.href });
    eq('题面逐字节 = node 侧（窄屏跑的是真货盘，不是空页面）', st.face, E.face);
    const cells = Array.from(document.querySelectorAll('.cell'));
    ck(`窄屏上 ${cells.length}/${E.n} 格全在（盘没被裁）`, cells.length === E.n, `${cells.length}/${E.n}`);
    const playTracks = getComputedStyle($('.play')).gridTemplateColumns.split(' ').filter(Boolean).length;
    ck(`布局**真的重排**了：.play 的 grid-template-columns 收成 1 条轨道（桌面是 2 条）`, playTracks === 1,
      `${playTracks} 条 · ${getComputedStyle($('.play')).gridTemplateColumns}`);
    const order = getComputedStyle(board).order;
    eq('重排证人 2：#board 的 order = -1（手指先到的是盘而不是说明）', order, '-1');
    const de = document.documentElement;
    ck(`盘不横向溢出：documentElement.scrollWidth(${de.scrollWidth}) <= clientWidth(${de.clientWidth}) + 1`,
      de.scrollWidth <= de.clientWidth + 1, `${de.scrollWidth}/${de.clientWidth}`);
    const rects = cells.map((el) => el.getBoundingClientRect());
    const minW = Math.min.apply(null, rects.map((r) => r.width));
    const minH = Math.min.apply(null, rects.map((r) => r.height));
    ck(`每一格命中盒都不小于 30px（CSS --cell clamp 的下限）：最小 ${minW.toFixed(2)}×${minH.toFixed(2)}px`,
      cells.length > 0 && minW >= 30 && minH >= 30, `minW ${minW.toFixed(2)} minH ${minH.toFixed(2)}`);
    board.scrollIntoView({ block: 'center', inline: 'nearest' });
    await wait(0);
    const outside = cells.filter((el) => {
      const r = el.getBoundingClientRect();
      const x = r.left + r.width / 2, y = r.top + r.height / 2;
      return !(x >= 0 && y >= 0 && x <= vw + 0.5 && y <= vh + 0.5);
    });
    ck(`把盘滚进视野后 ${cells.length - outside.length}/${cells.length} 格中心落在窄屏视口内（先证明到得了）`,
      outside.length === 0, `${outside.length} 格在外面 · 视口 ${vw}×${vh}`);
    const hitBad = cells.filter((el) => hitSelf(el) !== '');
    ck(`${cells.length - hitBad.length}/${cells.length} 格的可点命中盒落在自己那格里`, hitBad.length === 0,
      hitBad.slice(0, 4).map((el) => `${el.dataset.i}:${hitSelf(el)}`).join(' '));
    ck('窄屏下 #reject 仍是**真**隐藏且点不到', hiddenTight('#reject') && unhittable($('#reject')) === '',
      `${whyNotTight('#reject')} · ${unhittable($('#reject'))}`);
    return report({
      vw, vh, dpr, boardClientWidth: bcw, clientWidth: de.clientWidth, scrollWidth: de.scrollWidth,
      wantViewport: `${W}x${Hh}x${Dp}`, mobileFlagRequested: E.mobileWant === true,
      mediaNarrow: mq('(max-width: 720px)'), mediaDesktop: mq('(min-width: 721px)'),
      playTracks, boardOrder: order, cellsHit: `${cells.length - hitBad.length}/${cells.length}`,
      minCellPx: Number(minW.toFixed(2)), minCellPy: Number(minH.toFixed(2)),
      tier: st.tier, round: st.round, fingerprint: null, href: location.href,
    });
  };

  // ================================================================ 腿 8 · reload-resume
  /**
   * 为什么必须走 Page.reload 而不是 fragment 导航：本仓的档位/局号**就写在 fragment 里**，
   * 只换 fragment 时 window.tasquare 还活着、makeGame 里那段 storage.getItem 一次都没跑 ——
   * "恢复了"其实是"什么都没丢"，那是续局闸最经典的假绿。
   * 铁证三条全在刷新后那一回合：① node 在派发刷新**之前**取的 timeOrigin/哨兵与刷新后不同/读不到；
   * ② 页面自己交回的刷新前读数与 node 那份逐字相同（两条通道在刷新前合流）；
   * ③ 这一腿故意用 mid-8x8/7（**不等于**默认档 TIERS[0]/0），续上的两格只可能来自 localStorage。
   */
  let RS = null;
  const resume = async (ctx) => {
    const round = (ctx && ctx.round) || 0;
    const E = exp();
    if (!E || !E.ok) { ck('续局腿的期望由 node 证人交回', false, String(w.__expectRaw).slice(0, 160)); return report(); }
    if (round === 0) {
      const gen = await mod('./js/engine/generate.js');
      const st = await loadClean(E.tier, E.round);
      ck('本腿先把档清干净（腿内自带前置，不吃上一条腿写的档）',
        Object.keys(localStorage).filter((k) => k.indexOf('tasquare:') === 0).length === 0, JSON.stringify(Object.keys(localStorage)));
      ck('这一档**不等于**默认档（TIERS[0]/0）⇒ 续出来的读数才有出处',
        E.tier !== gen.TIERS[0].key || E.round !== 0, `${E.tier}/${E.round} vs 默认 ${gen.TIERS[0].key}/0`);
      const blk = E.ledger.filter((x) => x.v === 1)[0].i;
      const wht = E.ledger.filter((x) => x.v === 2)[0].i;
      T().mark(blk, 1);
      T().mark(wht, 2);
      const st2 = S();
      ck(`写了两格：黑 1/1（格 ${blk}）· 白 1/1（格 ${wht}）· 未知 ${st2.counts.unknown}/${E.freeCells - 2}`,
        st2.counts.black === 1 && st2.counts.white === 1 && st2.counts.unknown === E.freeCells - 2, JSON.stringify(st2.counts));
      const saveKey = `tasquare:v1:${E.tier}:${E.round}`;
      const raw = localStorage.getItem(saveKey);
      ck(`${saveKey} 被写了（刷新前证人之一）`, typeof raw === 'string' && raw.length > 0, String(raw).slice(0, 120));
      let marks = '';
      try { marks = JSON.parse(raw).marks; } catch { marks = '<读不开>'; }
      ck('档里那串 marks 就是这两格（一个 1、一个 2，其余全 0），且 seed 与页面同串',
        typeof marks === 'string' && marks.length === E.n &&
        marks.split('').filter((c) => c === '1').length === 1 && marks.split('').filter((c) => c === '2').length === 1 &&
        JSON.parse(raw).seed === E.seed, `${marks}`);
      RS = { blk, wht, marks };
      const pre = {
        seed: st2.seed, tier: st2.tier, round: st2.round, ok: st2.ok, face: st2.face,
        counts: st2.counts, status: text($('#status')), seedline: text($('#seedline')),
      };
      // carry 由 **node 保管**再送回来：刷新之后这个闭包是全新的，页内变量一律归零，
      // 那两格的编号只能走这条通道（走到了就是"新文档确实接着同一份档"的一部分）。
      return Object.assign({
        reload: E.fakeReload === 1 ? `fragment:${location.href}#resume-probe` : 1,
        stage: 'reload', pre, carry: { marks: RS.marks, blk: RS.blk, wht: RS.wht },
      }, drain());
    }
    const carry = (ctx && ctx.carry) || {};
    const pre = carry.pre || null;
    ck('刷新前证人由 node 带回来了（不是页面在同一个上下文里自己跟自己对表）',
      !!pre && typeof pre.status === 'string' && typeof pre.seed === 'string', JSON.stringify(carry).slice(0, 200));
    if (!pre) return report({ href: location.href });
    ck('node 那份证人里带着它在旧上下文里设的哨兵串（派发前它确实跑进了那个文档）',
      typeof pre.sentinel === 'string' && pre.sentinel.length > 0, String(pre.sentinel));
    ck('node 取的刷新前读数与页面自己交回的读数逐字相同（两条通道在刷新前就合流）',
      !!carry.pageReported && carry.pageReported.seed === pre.seed && carry.pageReported.status === pre.status &&
      carry.pageReported.seedline === pre.seedline && carry.pageReported.face === pre.face &&
      JSON.stringify(carry.pageReported.counts) === JSON.stringify(pre.counts),
      JSON.stringify(carry.pageReported).slice(0, 200));
    const st = S();
    ck('新文档里 window.tasquare 又起来了（state() 有读数）', !!st, 'null');
    if (!st) return report({ href: location.href });
    ck('node 在刷新前设的 window 哨兵在新文档里读不到了（**新 JS 上下文**的铁证；片段跳转它还在 ⇒ 这条红）',
      w.__tasquarePreReloadSentinel === undefined, String(w.__tasquarePreReloadSentinel));
    const nowOrigin = String(performance.timeOrigin);
    ck('performance.timeOrigin 与 node 带回来的旧值**不同**（新文档的第二条铁证）',
      nowOrigin !== pre.timeOrigin, `刷新前 ${pre.timeOrigin} / 刷新后 ${nowOrigin}`);
    ck('location.href 与刷新前逐字相同（fragment 导航会偷改 hash ⇒ 这条红）',
      location.href === pre.href, `刷新前 ${pre.href} / 刷新后 ${location.href}`);
    ck(`reloadMode = ${carry.reloadMode}（node 派发的必须是 page-reload，不是 fragment-sabotage）`,
      carry.reloadMode === 'page-reload', String(carry.reloadMode));
    eq('档位与局号原样续上', `${st.tier}/${st.round}`, `${pre.tier}/${pre.round}`);
    eq('seed 与刷新前同串（不是日期算的）', st.seed, pre.seed);
    eq('seed = node 证人的那一串', st.seed, E.seed);
    eq('题面逐字节 = node 侧（重铺出来的还是那张盘）', st.face, E.face);
    ck(`两格从 localStorage 回来了：黑 ${st.counts.black}/1 · 白 ${st.counts.white}/1 · 未知 ${st.counts.unknown}/${E.freeCells - 2}`,
      st.counts.black === 1 && st.counts.white === 1 && st.counts.unknown === E.freeCells - 2, JSON.stringify(st.counts));
    ck(`DOM 上那两格的 class 也回来了（格 ${carry.blk}=blk · 格 ${carry.wht}=wht；编号走 node 的 carry，不是页内变量）`,
      Number.isInteger(carry.blk) && Number.isInteger(carry.wht) &&
      !!cellEl(carry.blk) && cellEl(carry.blk).classList.contains('blk') &&
      !!cellEl(carry.wht) && cellEl(carry.wht).classList.contains('wht'),
      `${classes(cellEl(carry.blk))} | ${classes(cellEl(carry.wht))}`);
    eq('#status 与刷新前逐字相同（同一句话说两遍）', text($('#status')), pre.status);
    eq('#seedline 与刷新前逐字相同', text($('#seedline')), pre.seedline);
    const saveKey = `tasquare:v1:${st.tier}:${st.round}`;
    const raw = localStorage.getItem(saveKey);
    let marksNow = '';
    try { marksNow = JSON.parse(raw || '{}').marks || ''; } catch { marksNow = '<读不开>'; }
    ck('刷新后档里那串 marks 与刷新前逐字相同（新文档把它读回来又原样写回去）',
      marksNow === carry.marks, `${marksNow} vs ${carry.marks}`);
    const out = report({
      tier: st.tier, round: st.round, seed: st.seed, counts: st.counts, marksSame: marksNow === carry.marks,
      status: text($('#status')), seedline: text($('#seedline')),
      timeOriginChanged: nowOrigin !== pre.timeOrigin, sentinelCleared: w.__tasquarePreReloadSentinel === undefined,
      reloadMode: carry.reloadMode || 'none（node 没派发刷新）', href: location.href,
      _timeOriginBefore: pre.timeOrigin, _timeOriginAfter: nowOrigin,
    });
    RS = null;
    return out;
  };

  // ================================================================ 腿 9 · reject-panel
  /**
   * 走**自然拒盘**的那一局号（node 侧实测：produce('irr-8x8',0) → {ok:false, fail:'pencil', draws:6}，
   * /1 → draws:1，/2 出货 64 格）。页内不许 load 一个注入盘来"造"拒盘 —— 那条要验的就是真局号会走到这里。
   * 刚修的那个 bug 也钉在这里：#status 是 aria-live，拒盘屏留着上一局的数字 = 同一张页面同时说出
   * "这一局没出货"和"自由格 32：黑 1"两种结论，所以五条读数文字 + #violations 的 innerHTML 必须全空。
   */
  const STALE_IDS = ['status', 'seedline', 'result', 'cert', 'hintline'];
  let RJ = null;
  const reject = async (ctx) => {
    const round = (ctx && ctx.round) || 0;
    const E = exp();
    const R = E && E.rounds ? E.rounds : null;
    if (!R || !R['0'] || !R['1'] || !R['2']) {
      ck('拒盘腿的三局期望（0/1 拒盘 · 2 出货）由 node 证人一次交回', false, String(w.__expectRaw).slice(0, 200));
      return report();
    }
    const st = S();
    if (!st) { ck('拒盘腿页面有 state() 读数', false, 'null'); return report(); }
    const stale = STALE_IDS.map((id) => `#${id}「${text(document.getElementById(id))}」`).filter((s, i) => text(document.getElementById(STALE_IDS[i])) !== '');
    if (round === 0) {
      eq('首屏局号就是导航 URL 那一局（#irr-8x8/0）', `${st.tier}/${st.round}`, `${E.tier}/0`);
      ck('这一局是**自然**拒盘（state().ok=false · reject=pencil）', st.ok === false && st.reject === R['0'].fail,
        `ok=${st.ok} reject=${st.reject} 期望 fail=${R['0'].fail}`);
      eq('state().face 在拒盘局是 null（没有题面可画）', String(st.face), 'null');
      ck('#reject 展开（hidden=false 且有 rect）', $('#reject').hidden === false && shown('#reject'), whyNotTight('#reject'));
      ck('#play **真**收起（hiddenTight：display:none 且 0 个 rect）', hiddenTight('#play'), whyNotTight('#play'));
      ck(`#board 有 0 个格子节点且**真**隐藏（${document.querySelectorAll('#board .cell').length}/0）`,
        document.querySelectorAll('#board .cell').length === 0 && hiddenTight('#board'),
        `${document.querySelectorAll('#board .cell').length} 格 · ${whyNotTight('#board')}`);
      const det = text($('#reject-detail'));
      ck(`#reject-detail 写着 fail=${R['0'].fail} · draws=${R['0'].draws}`,
        det.indexOf(`fail=${R['0'].fail}`) >= 0 && det.indexOf(`draws=${R['0'].draws}`) >= 0, det.slice(0, 200));
      ck(`#reject-detail 写着收据的铺面 ${R['0'].receipt.layTried} 张 · 裁判调用 ${R['0'].receipt.shipRuns} 次`,
        det.indexOf(`铺面 ${R['0'].receipt.layTried} 张`) >= 0 && det.indexOf(`裁判调用 ${R['0'].receipt.shipRuns} 次`) >= 0,
        det.slice(0, 220));
      ck('拒盘局里读屏那五条文字与 #violations 全空（陈旧 aria-live = 同一页面上的第二个结论）',
        stale.length === 0, stale.join(' '));
      ck('#reject 的中心点量得到（下一回合 node 要点它）', hitSelf($('#reject-next')) === '', hitSelf($('#reject-next')));
      RJ = { det };
      return { pending: [centerOf($('#reject-next'))], stage: 'next-1' };
    }
    if (round === 1) {
      const st2 = S();
      eq('点了 #reject-next（真指针）之后局号 +1', `${st2.tier}/${st2.round}`, `${E.tier}/1`);
      ck('第 1 局仍**自然**拒盘（fail=pencil · draws=1 = node 侧实测）',
        st2.ok === false && st2.reject === R['1'].fail && st2.round === 1,
        `ok=${st2.ok} reject=${st2.reject} round=${st2.round} 期望 fail=${R['1'].fail}`);
      const d2 = text($('#reject-detail'));
      ck(`#reject-detail 换成第 1 局的账（draws=${R['1'].draws} · 铺面 ${R['1'].receipt.layTried} · 裁判 ${R['1'].receipt.shipRuns}）`,
        d2.indexOf(`draws=${R['1'].draws}`) >= 0 && d2.indexOf(`铺面 ${R['1'].receipt.layTried} 张`) >= 0 &&
        d2.indexOf(`裁判调用 ${R['1'].receipt.shipRuns} 次`) >= 0 && d2 !== RJ.det, d2.slice(0, 200));
      ck('#reject 仍展开 · #play 仍真收起', shown('#reject') && hiddenTight('#play'), whyNotTight('#play'));
      ck('换局之后读屏那五条仍是空的（不是只在首屏擦干净）',
        STALE_IDS.every((id) => text(document.getElementById(id)) === '') && html($('#violations')) === '',
        STALE_IDS.map((id) => `#${id}「${text(document.getElementById(id))}」`).join(' '));
      return { pending: [centerOf($('#reject-next'))], stage: 'next-2' };
    }
    const st3 = S();
    eq('再点一次 #reject-next ⇒ 第 2 局', `${st3.tier}/${st3.round}`, `${E.tier}/2`);
    ck(`第 2 局出货（state().ok=true · 64 格 = node 侧 n=${R['2'].n}）`,
      st3.ok === true && st3.counts.free === R['2'].freeCells && document.querySelectorAll('#board .cell').length === R['2'].n,
      `ok=${st3.ok} 格 ${document.querySelectorAll('#board .cell').length}/${R['2'].n}`);
    eq('第 2 局的题面逐字节 = node 侧', st3.face, R['2'].face);
    ck('#play 展开、#reject 真收起且点不到', shown('#play') && hiddenTight('#reject') && unhittable($('#reject')) === '',
      `${whyNotTight('#reject')} · ${unhittable($('#reject'))}`);
    eq('#status 写着自由格与三态计数（node 侧的 freeCells）', text($('#status')),
      `自由格 ${R['2'].freeCells}：黑 0 · 白 0 · 未知 ${R['2'].freeCells}`);
    ck('#seedline 写着档位·局号·seed 三件事', /第 2 局/.test(text($('#seedline'))) && text($('#seedline')).indexOf(R['2'].seed) > 0,
      text($('#seedline')).slice(0, 120));
    const out = report({
      tier: st3.tier, round: st3.round, cells: `${document.querySelectorAll('#board .cell').length}/${R['2'].n}`,
      rejectDetail0: RJ ? RJ.det.slice(0, 90) : null, failByRound: [R['0'].fail, R['1'].fail],
      drawsByRound: [R['0'].draws, R['1'].draws], shippedAt: `${E.tier}/2`, href: location.href,
    });
    RJ = null;
    return out;
  };

  // ================================================================ 腿 10 · cross-engine
  /**
   * 页侧只负责把 4 档 × 5 局的**题面串**与 DOM 上的 draws 读数收齐（含自然拒盘的那几局），
   * 逐条比发生在 **node 侧**（playtest.cjs 的 crossEngineRows：它 import 的就是这批 js/ 模块）。
   * 两侧各自跑两遍 produce() 永远互相同意，所以真正的钉子是 node 侧那两个**写死的常量**：
   * 只有逐字节比对能把跨引擎的 PRNG 钉住。
   */
  const CE_ROUNDS = [0, 1, 2, 3, 4];
  const crossengine = async () => {
    const gen = await mod('./js/engine/generate.js');
    const rules = await mod('./js/engine/rules.js');
    const { countSolutions } = await mod('./js/engine/counter.js');
    const keys = gen.TIERS.map((t) => t.key);
    ck('页侧 import 到的 TIERS 与档位导航同数（4 档；import 按 document.baseURI 解得开）',
      keys.length === document.querySelectorAll('#tiers .tier').length && keys.length > 0,
      `${keys.length} vs ${document.querySelectorAll('#tiers .tier').length}`);
    const samples = [];
    const noState = [];
    let msCapBreaches = 0;
    for (const tier of keys) {
      for (const round of CE_ROUNDS) {
        T().load(tier, round);
        await wait(0);
        const st = S();
        if (!st) { noState.push(`${tier}/${round}`); continue; }
        let draws = null;
        if (!st.ok) {
          const m = /draws=(\d+)/.exec(text($('#reject-detail')));
          draws = m ? Number(m[1]) : null;
        } else {
          // ms 闸的现场证人：对**这张出货盘**再数一次（nodeCap 用出货值、msCap=Infinity），
          // 只有 stoppedBy==='ms' 才算击穿 —— >0 就说明这台机器的速度参与了出货判定。
          const c = countSolutions(gen.produce(tier, round).face,
            { ...rules.DEFAULTS, limit: 2, nodeCap: 200_000, msCap: Infinity });
          if (c.stoppedBy === 'ms') msCapBreaches++;
        }
        samples.push({ tier, round, ok: st.ok === true, face: st.face, fail: st.reject === null ? null : st.reject, draws });
      }
    }
    ck(`${samples.length}/${keys.length * CE_ROUNDS.length} 张盘都取到 state() 读数（有读数的才有资格被比）`,
      noState.length === 0 && samples.length === keys.length * CE_ROUNDS.length, `缺 ${noState.join(' ') || '0'}`);
    ck(`页侧 msCap 击穿 ${msCapBreaches} 次（必须 0）`, msCapBreaches === 0, `${msCapBreaches}`);
    // 恢复：这一腿开过 20 张盘，收尾回到默认那一局，别把 8x8 的档留给下一条腿
    await loadClean('easy-6x6', 0);
    return report({
      boards: samples.length, tiers: keys, rounds: CE_ROUNDS,
      shipped: samples.filter((s) => s.ok).length, rejected: samples.filter((s) => !s.ok).length,
      chromeMsCapBreaches: msCapBreaches, href: location.href,
      nodeWitness: 'crossEngineFaces', samples,
    });
  };

  // ================================================================ 腿 11 · canary（负样本通道）
  const canary = async () => {
    const E = exp();
    ck('canary 的三条通道读数由 node 侧证人算好交回（页内不现生成盘子）',
      !!E && E.ok === true && Array.isArray(E.natural) && Array.isArray(E.starvedShip),
      String(w.__expectRaw).slice(0, 200));
    if (!E || !E.ok) return report({ href: location.href });
    const gen = await mod('./js/engine/generate.js');
    const rules = await mod('./js/engine/rules.js');
    const { countSolutions } = await mod('./js/engine/counter.js');
    const brief = (r) => {
      const x = r.receipt || {};
      // 键集必须与 node 侧的 rec() **一模一样**：少带一个键就是"两条通道各报各的、谁也没对上"，
      // 而 same() 只遍历期望的键 —— 页侧缺键会静默地报 undefined。
      return {
        ok: r.ok === true, fail: r.ok === true ? null : String(r.fail),
        draws: r.draws === undefined ? null : Number(r.draws),
        layTried: x.layTried || 0, shipRuns: x.shipRuns || 0, certStopped: x.certStopped || 0,
        keptByBudget: x.keptByBudget || 0, probes: x.probes || 0,
        certNodes: x.certNodes || 0, shipNodes: x.shipNodes || 0,
      };
    };
    const same = (a, b) => Object.keys(b).every((k) => String(a[k]) === String(b[k]));
    let negFound = 0;
    for (const s of E.natural) {
      const got = brief(gen.produce(s.tier, s.round));
      ck(`负样本 ${s.name}：页侧 produce(生产预算) 的读数逐条 = node 侧`,
        same(got, s.expect) && got.ok === false,
        `页 ${JSON.stringify(got)} / node ${JSON.stringify(s.expect)}`);
      if (same(got, s.expect) && got.ok === false) negFound++;
    }
    for (const s of E.starvedShip) {
      const got = brief(gen.produce(s.tier, s.round, { ship: { nodeCap: E.cutNodeCap, msCap: Infinity } }));
      ck(`负样本 ${s.name}：页侧掐停**出货裁判**预算的读数逐条 = node 侧（ok=${got.ok} fail=${got.fail} draws=${got.draws}）`,
        same(got, s.expect), `页 ${JSON.stringify(got)} / node ${JSON.stringify(s.expect)}`);
      if (same(got, s.expect) && got.ok === false) negFound++;
    }
    for (const s of E.starvedProbe) {
      const got = brief(gen.produce(s.tier, s.round, { probe: { nodeCap: E.cutNodeCap, msCap: Infinity } }));
      ck(`探针通道 ${s.name}：页侧掐停**裁线索**预算的读数 = node 侧（实测 ${got.ok ? '出货' : `拒盘 ${got.fail}`}）`,
        same(got, s.expect), `页 ${JSON.stringify(got)} / node ${JSON.stringify(s.expect)}`);
    }
    // 三条通道的账分别摊开（0 条的那一条必须**响亮地**报出来，不许被总数掩盖）
    ck(`自然拒盘通道：实得 ${E.natural.length} 张（必须 ≥1）`, E.natural.length >= 1, `实得 ${E.natural.length}`);
    ck(`掐停出货预算通道：实得负样本 ${E.shipNegCount}/${E.starvedShip.length}（必须 ≥1 才算"拒盘能被预算逼出来"）`,
      E.shipNegCount >= 1, `实得 ${E.shipNegCount}`);
    ck(`掐停探针通道：负样本 ${E.probeNegCount}/${E.starvedProbe.length} —— 本仓实测 0（carve 击穿时那条线索**不许删**，` +
      '方向安全只会多留线索 ⇒ 这一条通道逼不出负样本，钉住实测值而不是钉住愿望）',
      E.probeNegCount === Number(E.probeNegCount) && E.probeNegCount === 0, `实得 ${E.probeNegCount}`);
    ck(`负样本合计 实得 ${negFound} ≥ 1（页侧自己数出来的那一份，不抄 node 的计数）`, negFound >= 1, `实得 ${negFound}`);
    // ms 闸的结构证人：注入的 msCap 是 Infinity，而搜索停在第 41 个节点（<256）⇒ 钟连查都没查过
    const base = gen.produce(E.tier, E.round);
    ck('canary 底座是一张出货盘（stoppedCall 才有对照物）', base.ok === true, `ok=${base.ok} fail=${base.fail}`);
    const cut = { ...rules.DEFAULTS, limit: 2, nodeCap: E.cutNodeCap, msCap: Infinity };
    const r = countSolutions(base.face, cut);
    ck(`注入的 msCap 是 Infinity（Number.isFinite=${Number.isFinite(cut.msCap)}）⇒ 归因不可能是 ms`,
      Number.isFinite(cut.msCap) === false && cut.nodeCap === E.cutNodeCap, JSON.stringify({ nodeCap: cut.nodeCap, msCap: String(cut.msCap) }));
    ck(`同一张盘在 nodeCap=${E.cutNodeCap} 下确实停住：stopped=${r.stopped} 且停在第 ${r.nodes} 个节点`,
      r.stopped === true && r.nodes === E.stoppedCall.nodes, `页 ${r.stopped}/${r.nodes} / node ${E.stoppedCall.stopped}/${E.stoppedCall.nodes}`);
    ck(`归因逐字 = 'node'（counter.js 每 256 个节点才查一次钟，${r.nodes} < 256 ⇒ ms 闸结构上到不了）`,
      r.stoppedBy === E.stoppedCall.stoppedBy && r.stoppedBy === 'node' && r.nodes < 256,
      `页 stoppedBy=${r.stoppedBy} nodes=${r.nodes} / node ${E.stoppedCall.stoppedBy} ${E.stoppedCall.nodes}`);
    ck('掐停之后 count 不是"唯一"的读数（stopped 不是读数，撞预算就不是答案）',
      r.stopped === true && (r.count !== 1 || r.stoppedBy === 'node'), `count=${r.count} stopped=${r.stopped}`);
    await loadClean('easy-6x6', 0);
    return report({
      negatives: E.negatives, negFoundByPage: negFound, natural: E.natural.length,
      shipNeg: `${E.shipNegCount}/${E.starvedShip.length}`, probeNeg: `${E.probeNegCount}/${E.starvedProbe.length}`,
      cutNodeCap: E.cutNodeCap, stoppedBy: r.stoppedBy, stoppedNodes: r.nodes,
      msCapNeverUsed: Number.isFinite(cut.msCap) === false, baseTier: E.tier, baseRound: E.round,
      href: location.href,
    });
  };

  w.__scn = { open, domint, playfull, illegal, pointer, keyboard, narrow, resume, reject, crossengine, canary };
})(window);
