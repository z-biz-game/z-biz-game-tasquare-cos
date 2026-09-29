// 最小 CDP 驱动（需要 Node 22+：全局 WebSocket/fetch，零依赖）· たすくえあ Tasquare 浏览器闸
//
// env: CDP_PORT  devtools 端口，本仓 9611（端口表：root web 5611 / 前缀 web 5612 / CDP 9611）
//      BASE_URL  页面 origin，默认 http://127.0.0.1:5611/
//      NAV_URL   scenario/interact 的**导航 URL**（同源，可带 #档位/局号）；缺省 = BASE_URL
//      VIEWPORT  可选 "WxH" 或 "WxHxD"（D=deviceScaleFactor，缺省 1）；设了就在**首次导航之前**
//                覆盖 device metrics。**覆写挂在 attach 出来的那个 session 上**：进程退出 = 会话关闭 =
//                覆写消失，所以窄屏腿必须在自己那次调用里带 VIEWPORT，绝不许"先起一个进程设覆写就退出"
//                （那样跑断言的进程从没被覆写，只是把桌面断言在 vw 1280 上又跑一遍 —— 家族里最贵的假绿）。
//      EMULATE_MOBILE  '1' 时 Emulation.setDeviceMetricsOverride 带 mobile:true。
//                **本仓实测**：这一位取 1 与取 0 的读回值完全相同（innerWidth/innerHeight/
//                devicePixelRatio/#board.clientWidth 四对全等），因为本仓只靠 width=device-width 那条
//                meta + 一条 @media (max-width:720px) 就重排到位，没有可被啃掉的经典滚动条。
//                所以窄屏腿**没有任何一条断言挂在这个标志上**（挂上去就是一条永远同意的白断言）：
//                覆写的证人只有那四对读数与两条互为反证的 matchMedia。
//                它只是让请求的形状更贴近真机，不构成证据。
//      MAX_ROUNDS interact 的回合上限（默认 12）
//      SABOTAGE  闸的**阴性自证**开关：把 node 侧期望题面改错一位（只对 SABOTAGE_SEED 那一档那一局），
//                verify.sh 另在 open 腿的期望里把 okWant 改成 false。绿不了的闸不是闸，
//                这一条不参与任何判定、不放宽任何阈值 —— 它只用来证明"改错了会红"。
//
//   node tools/playtest.cjs open <url>              新开一个 tab，打印启动期 console
//   node tools/playtest.cjs eval '<expr>' [nonav]   求值（await promise），打印结果
//   node tools/playtest.cjs scenario <名> [json]    注入 tools/scenarios.js，跑 __scn.<名>()
//   node tools/playtest.cjs interact <名> [json]    同上，但走 **CDP 真指针 / 真按键 / 真刷新**多回合：
//                                                   页面交回 {pending:[{x,y}…]} ⇒ 本机用
//                                                   Input.dispatchMouseEvent 点下去；
//                                                   页面交回 {pendingKeys:[{key}…]} ⇒ 本机用
//                                                   Input.dispatchKeyEvent 按下去（键盘腿唯一通道）；
//                                                   页面交回 {reload:1} ⇒ 本机**先取刷新前证人**再 Page.reload
//                                                   （续局腿唯一通道；reload:'fragment:…' 只给阴性自证用）；
//                                                   页面交回 {carry:{…}} ⇒ 由 node 保管并在下一回合送回
//   node tools/playtest.cjs witness <tier> <round[,round…]>  **node 侧证人**（不起 Chrome）：用浏览器
//                                                   加载的同一批 js/ 模块现算那张盘的题面条、铅笔账本、
//                                                   裁判读数、违反码。逗号 = 多局（拒盘腿一次要三局）。
//   node tools/playtest.cjs canary <tier> <round>   **负样本 canary 的 node 侧证人**（不起 Chrome）：
//                                                   自然拒盘局 / 掐停出货预算 / 掐停裁线索探针三条通道的
//                                                   期望读数全在这里算，页内只比对。掐停只许用 nodeCap
//                                                   （<256 ⇒ counter.js 里每 256 个节点才查一次的 ms 闸
//                                                   结构上到不了），绝不许用 msCap 造负样本。
//   node tools/playtest.cjs shot <file.png>
//   node tools/playtest.cjs logs
//
// 三条本组织付过学费的口径，写在这个文件的行为里：
//   · **scenario/interact 每次都重新 navigate**（先落到同 origin 的 404 再落 NAV_URL）：本仓的档位/局号
//     走的是 `#档位/局号` 这种 fragment，两次调用如果 NAV_URL 只差一个 fragment，Page.navigate 就是
//     同文档跳转 —— 文档没换、window.tasquare 还挂着上一腿的涂黑。先跳 404 保证第二跳必然是一次真导航。
//     期望值走 argv（第二个参数）→ window.__expectRaw（**原样字符串**，场景里自己 JSON.parse），
//     **不走 URL 的 #expect=**：同一个文档里只换 fragment 不是导航。
//   · 选哪个页面 attach 由 BASE_URL 的 origin 决定，不写死端口：一个悄悄落在 about:blank 上的 eval
//     读起来像"部署坏了"，实际是门禁连错了对象。
//   · **指针腿走 CDP，不走 element.click()**：dispatchMouseEvent 产生的是浏览器自己的
//     mousedown/mouseup/click 序列，命中盒、事件目标、焦点都由 Chrome 决定 —— 这才叫"真指针"。
//     页面侧只允许交回坐标（它量到的 clientX/clientY），坐标到点击的这一步在 node 这边发生。
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

const PORT = Number(process.env.CDP_PORT || 9611);
const BASE = process.env.BASE_URL || 'http://127.0.0.1:5611/';
const ORIGIN = new URL(BASE).origin;
const SABOTAGE = process.env.SABOTAGE === '1';
// 阴性自证只改**一张盘**的期望：这样"红"落在具体那一档那一局上，而不是整批一起红 ——
// 整批红分不清是比对逻辑坏了还是期望没接上。irr-8x8/2 只被 crossengine 腿用，归因最干净。
const SABOTAGE_SEED = process.env.SABOTAGE_SEED || 'irr-8x8/2';
const cmd = process.argv[2];
const arg = process.argv[3];
const rest = process.argv[4];
const isOurs = (u) => typeof u === 'string' && u.startsWith(ORIGIN);

/**
 * VIEWPORT → { width, height, dpr, mobile }；不接受的形状一律当"没设"（桌面腿走 Chrome 窗口尺寸）。
 * dpr 越界直接抛：静默按 1 跑就是"窄屏腿在桌面上重跑"那颗假绿的起手式。
 */
function parseViewport(s) {
  const str = String(s || '');
  if (!str) return null;
  const m = /^(\d+)x(\d+)(?:x(\d+))?$/.exec(str);
  if (!m) throw new Error(`VIEWPORT 形状不认识（要 WxH 或 WxHxD）：${str}`);
  const dpr = m[3] === undefined ? 1 : Number(m[3]);
  if (!(dpr >= 1 && dpr <= 8)) throw new Error(`deviceScaleFactor 不在 1..8 里：${dpr}`);
  return { width: Number(m[1]), height: Number(m[2]), dpr, mobile: process.env.EMULATE_MOBILE === '1' };
}
const VIEWPORT = parseViewport(process.env.VIEWPORT);

const logs = [];

/** 把题面里第一个数字改错一位（'0'→'1'，其余 +1）；一个数字都没有就把第一个 '.' 换成 '1'。 */
function breakFace(s) {
  const str = String(s);
  for (let i = 0; i < str.length; i++) {
    const c = str[i];
    if (/[0-9]/.test(c)) {
      const next = c === '9' ? '8' : String(Number(c) + 1);
      return str.slice(0, i) + next + str.slice(i + 1);
    }
  }
  const dot = str.indexOf('.');
  return dot < 0 ? str + ' 1' : str.slice(0, dot) + '1' + str.slice(dot + 1);
}

// ── node 侧证人：import 的就是浏览器加载的那批 js/ 模块 ──────────────────────────────────
let ENG = null;
async function engine() {
  if (ENG) return ENG;
  const rel = (...p) => pathToFileURL(path.join(__dirname, '..', ...p)).href;
  const [gen, rules, pencil, counter, rng] = await Promise.all([
    import(rel('js', 'engine', 'generate.js')),
    import(rel('js', 'engine', 'rules.js')),
    import(rel('js', 'engine', 'pencil.js')),
    import(rel('js', 'engine', 'counter.js')),
    import(rel('js', 'engine', 'rng.js')),
  ]);
  ENG = { gen, rules, pencil, counter, rng };
  return ENG;
}

/**
 * 出货凭证的 node 半边：与 js/ui/game.js 的 certify() 同一条调用（同 opts、同一份 countSolutions），
 * 只取标量读数 —— solutions 数组一个字节都不带回页面（真值只该出现在闸的期望里）。
 */
async function nodeWitnessOf(tierKey, round) {
  const { gen, rules, pencil, counter, rng } = await engine();
  const out = gen.produce(tierKey, round);
  const rec = out.receipt || {};
  const seed = rng.seedOf(tierKey, round);
  const receipt = {
    layTried: rec.layTried || 0, shipRuns: rec.shipRuns || 0, probes: rec.probes || 0,
    certNodes: rec.certNodes || 0, shipNodes: rec.shipNodes || 0,
    certStopped: rec.certStopped || 0, keptByBudget: rec.keptByBudget || 0,
    clues: rec.clues || 0, pencilSteps: rec.pencilSteps || 0, pencilUnknown: rec.pencilUnknown || 0,
    shipStoppedBy: rec.shipStoppedBy === undefined ? null : rec.shipStoppedBy,
  };
  if (out.ok !== true) {
    return {
      tier: tierKey, round, ok: false, seed, fail: String(out.fail), draws: Number(out.draws) || 0,
      receipt, face: null, faceNode: null,
    };
  }
  const face = out.face;
  const rows = rules.faceRows(face).join('/');
  const pen = pencil.pencilSolve(face, rules.DEFAULTS);
  const ledger = pen.ledger
    .filter((x) => face.c[x.i] === rules.FREE)                  // 线索格的 [R1] 白不是玩家要做的一步
    .map((x) => ({ i: x.i, v: x.v, rule: x.rule }));
  const c = counter.countSolutions(face, { ...rules.DEFAULTS, limit: 2, nodeCap: 200_000, wantSolutions: true });
  const truth = (c.solutions && c.solutions[0]) || null;
  let vsPlayer = 0;
  if (truth) {
    const bs = new Uint8Array(face.h * face.w);
    for (const x of ledger) if (x.v === rules.BLK) bs[x.i] = 1;
    for (let i = 0; i < bs.length; i++) if ((bs[i] === 1) !== (truth[i] === 1)) vsPlayer++;
  }
  let clueCells = 0, qmarkCells = 0, freeCells = 0;
  for (let i = 0; i < face.c.length; i++) {
    if (face.c[i] === rules.FREE) freeCells++;
    else { clueCells++; if (face.c[i] === rules.QMARK) qmarkCells++; }
  }
  const blacks = ledger.filter((x) => x.v === rules.BLK).map((x) => x.i);
  // 非法整盘：把第一枚黑格改白，node 侧跑**同一个 verify()** 交出期望违反码表（页内只比对 li 条数与文字）
  let illegal = null;
  if (blacks.length) {
    const flip = blacks[0];
    const bs = new Uint8Array(face.h * face.w);
    for (const i of blacks) bs[i] = 1;
    bs[flip] = 0;
    const V = rules.verify(face, bs, rules.DEFAULTS);
    illegal = { i: flip, codes: V.map((v) => v.code), clauses: Array.from(new Set(V.map((v) => rules.CLAUSE_TEXT[v.code] || ''))) };
  }
  const firstFree = (() => { for (let i = 0; i < face.c.length; i++) if (face.c[i] === rules.FREE) return i; return -1; })();
  const kbStart = (() => {
    for (let i = 0; i < face.c.length; i++) {
      if (face.c[i] !== rules.FREE || (i % face.w) + 1 >= face.w) continue;
      if (face.c[i + 1] === rules.FREE) return i;                // 右邻也得是空格：键盘腿要落子，不能落在线索上
      }
    return -1;
  })();
  const broken = SABOTAGE && `${tierKey}/${round}` === SABOTAGE_SEED;
  return {
    tier: tierKey, round, ok: true, seed, face: broken ? breakFace(rows) : rows, faceNode: rows, sabotaged: broken,
    h: face.h, w: face.w, n: face.h * face.w, clueCells, qmarkCells, freeCells,
    colsTracks: face.w,
    ledger, blacks, whites: ledger.filter((x) => x.v === rules.WHT).length,
    cert: {
      count: c.count, nodes: c.nodes, stopped: c.stopped, clues: clueCells,
      pencilSteps: pen.steps, pencilUnknown: pen.unknown,
      rules: pencil.RULES.filter((k) => pen.fires[k] > 0).length,
      vsPlayer,
    },
    illegal,
    ptrCell: firstFree,
    kb: { start: kbStart, right: kbStart >= 0 ? kbStart + 1 : -1 },
    clauses: Object.values(rules.CLAUSE_TEXT),
    receipt,
  };
}

/**
 * 跨引擎对账的 node 半边：浏览器交回 (档位, 局号, 题面) 三元组，这里对同一批盘子现算并逐条比。
 * rows 与页面侧同形状（{test,pass,detail}），合进同一条 RESULT。
 */
async function crossEngineRows(samples) {
  const { gen, rules } = await engine();
  const rows = [];
  const goldens = {
    'easy-6x6/0': '4 4 . ? . 1/. . . 4 ? ./. . . . . ?/4 4 4 . . 5/0 ? . ? 5 ./1 . 1 . . 1',
    'irr-8x8/2': '1 . 4 . 1 . . ./. . . . . . . ?/1 . . . . . 1 ./. . . . . 10 . 0/. 4 . . . . . ./'
      + '. . . . . . . ./. . . . . . . 9/. 4 ? . 9 . . .',
  };
  let same = 0, compared = 0, failDiff = 0, drawsDiff = 0, msSeen = 0;
  const diffs = [];
  // 出货盘没有 fail/draws 这两个字段：node 侧是"缺键"（undefined），页侧是"显式 null"。
  // 这两种写法说的是同一件事（这张盘没被拒），所以先归一到同一个空串再比 ——
  // 归一化只动"缺键 vs null"这一层，题面与 ok 一个字节都不放过。
  const nz = (v) => (v === null || v === undefined ? '' : String(v));
  for (const s of samples) {
    const b = await nodeWitnessOf(s.tier, s.round);
    compared++;
    const okEq = !!s.ok === !!b.ok;
    const faceEq = String(s.face) === String(b.face);
    const failEq = nz(s.fail) === nz(b.fail);
    const drawsEq = nz(s.draws) === nz(b.draws);
    msSeen += Number(s.msCapBreaches) || 0;
    if (faceEq && okEq) same++;
    else diffs.push(`${s.tier}/${s.round} chrome=${s.face} 期望=${b.face}（node 实算 ${b.faceNode}）`);
    if (!failEq) failDiff++;
    if (!drawsEq) drawsDiff++;
    rows.push({
      test: `crossengine ${s.tier}/${s.round} 题面逐字节相同（${okEq ? '出货一致' : `出货判定不一致 chrome=${s.ok} node=${b.ok}`}）`,
      pass: okEq && faceEq && failEq && drawsEq,
      detail: faceEq && okEq
        ? (failEq && drawsEq ? '' : `fail ${s.fail}/${b.fail} · draws ${s.draws}/${b.draws}`)
        : `chrome=${JSON.stringify(s.face)} 期望=${JSON.stringify(b.face)}（node 实算 ${JSON.stringify(b.faceNode)}）`,
    });
  }
  for (const [tag, want] of Object.entries(goldens)) {
    const [tk, rd] = tag.split('/');
    const b = await nodeWitnessOf(tk, Number(rd));
    rows.push({
      test: `golden ${tag} 题面 = 常量（逐字节）`,
      pass: b.face === want,
      detail: b.face === want ? '' : `钉住的常量=${want} · node 实算=${b.faceNode} · 交回=${b.face}`,
    });
  }
  rows.push({
    test: `crossengine ${compared} 张盘的题面逐字节相同（跨引擎同一串 seed 同一张盘）`,
    pass: same === compared && compared > 0,
    detail: same === compared ? '' : `不一致 ${diffs.length} 张：${diffs.slice(0, 3).join(' | ')}`,
  });
  // 一把尺子量不出另一把尺子：两侧各自跑两遍 produce() 永远互相同意，哪怕生成器已经换了。
  // 所以这一条断的是"chrome 与 node 逐字节相同 **并且** node 与钉住的常量逐字节相同"。
  rows.push({
    test: 'crossengine fail 归因串逐张相同（同一批拒绝形状）',
    pass: failDiff === 0 && drawsDiff === 0 && compared > 0,
    detail: `fail 不同 ${failDiff} 张 · draws 不同 ${drawsDiff} 张`,
  });
  rows.push({
    test: `crossengine 页侧 msCap 击穿合计 = 0（实测 ${msSeen}）`,
    pass: msSeen === 0,
    detail: `>0 就是这台机器的速度参与了出货判定`,
  });
  rows.push({
    test: `crossengine 用尽的档位×局号网格覆盖 4 档（含自然拒盘的那几局）`,
    pass: (() => {
      const tiers = new Set(samples.map((s) => s.tier));
      return tiers.size === gen.TIERS.length && samples.some((s) => !s.ok) && samples.some((s) => s.ok);
    })(),
    detail: `档位 ${new Set(samples.map((s) => s.tier)).size}/${gen.TIERS.length} · 出货 ${samples.filter((s) => s.ok).length}/${samples.length}`,
  });
  return { rows, extra: { matched: same, compared, goldens: Object.keys(goldens).length, rulesLoaded: Object.keys(rules).length } };
}

/**
 * canary 的 node 侧证人：**三条通道的负样本与期望读数全在这里算出来**，页内只比对。
 *   ① 自然拒盘（生产预算）：irr-8x8/0、irr-8x8/1、easy-6x6/11、irr-6x6/0 —— fail 全是 'pencil'。
 *   ② 掐停**出货裁判**预算（nodeCap=40 < 256）：同一局号被迫走 reject 分支，归因只能是 nodes。
 *   ③ 掐停**裁线索探针**预算（题目里点名要量的那一条）：本仓实测 0 张负样本 ——
 *      carve() 击穿时那条线索**不许删**（方向安全），所以探针掐停只会多留线索、把盘变得更简单，
 *      结构上产不出负样本。这一条按实测断，不按期望断（详见下面 rows 里那条 0/N 的读数）。
 * 三条通道注入的 msCap 一律是 Infinity：counter.js 每 256 个节点才查一次钟，
 * 而 40 节点的搜索停在第 41 个节点上 —— ms 造不出负样本，这一点由 stoppedCall 那一条当场量出来。
 */
async function canaryWit(tierKey, round) {
  const { gen, rules, counter } = await engine();
  const STOP_NODE_CAP = 40;
  const cut = { ship: { nodeCap: STOP_NODE_CAP, msCap: Infinity } };
  const rec = (r) => {
    const x = r.receipt || {};
    return {
      ok: r.ok === true, fail: r.ok === true ? null : String(r.fail), draws: r.draws === undefined ? null : Number(r.draws),
      layTried: x.layTried || 0, shipRuns: x.shipRuns || 0, certStopped: x.certStopped || 0,
      keptByBudget: x.keptByBudget || 0, probes: x.probes || 0, certNodes: x.certNodes || 0, shipNodes: x.shipNodes || 0,
    };
  };
  const natural = [['irr-8x8', 0], ['irr-8x8', 1], ['easy-6x6', 11], ['irr-6x6', 0]]
    .map(([t, r]) => ({ name: `自然拒盘 ${t}/${r}`, tier: t, round: r, budget: null, expect: rec(gen.produce(t, r)) }))
    .filter((s) => s.expect.ok === false);
  const starvedShip = [[tierKey, round], ['mid-8x8', 7], ['irr-8x8', 2], ['easy-6x6', 0]]
    .map(([t, r]) => ({ name: `掐停出货预算 ${t}/${r}`, tier: t, round: r,
      budget: { nodeCap: STOP_NODE_CAP, msCapInfinity: true }, expect: rec(gen.produce(t, r, cut)) }));
  const shipNeg = starvedShip.filter((s) => s.expect.ok === false);
  const starvedProbe = [['easy-6x6', 11], ['irr-8x8', 0], [tierKey, round]]
    .map(([t, r]) => ({ name: `掐停探针预算 ${t}/${r}`, tier: t, round: r,
      expect: rec(gen.produce(t, r, { probe: { nodeCap: STOP_NODE_CAP, msCap: Infinity } })) }));
  const probeNeg = starvedProbe.filter((s) => s.expect.ok === false);
  // ms 闸结构上到不了的正面证人：同一张出货盘、nodeCap 40、msCap Infinity ⇒ 停在第 41 个节点且署名 'node'
  const base = gen.produce(tierKey, round);
  let stoppedCall = null;
  if (base.ok) {
    const r = counter.countSolutions(base.face, { ...rules.DEFAULTS, limit: 2, nodeCap: STOP_NODE_CAP, msCap: Infinity });
    stoppedCall = { stopped: r.stopped, stoppedBy: r.stoppedBy, nodes: r.nodes, count: r.count, msCapIsInfinity: !Number.isFinite(cut.ship.msCap) };
  }
  const missing = [];
  if (!natural.length) missing.push('自然拒盘');
  if (!shipNeg.length) missing.push('掐停出货预算的负样本');
  if (!stoppedCall) missing.push('出货盘（stoppedCall 的底座）');
  if (missing.length) {
    return { ok: false, why: 'node 侧交不出这一张负样本', missing, natural, starvedShip, starvedProbe };
  }
  return {
    ok: true, tier: tierKey, round, cutNodeCap: STOP_NODE_CAP, cutMsCapInfinity: !Number.isFinite(cut.ship.msCap),
    natural, starvedShip, starvedProbe, negatives: natural.length + shipNeg.length,
    shipNegCount: shipNeg.length, naturalNegCount: natural.length, probeNegCount: probeNeg.length,
    stoppedCall,
  };
}

class CDP {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.pending = new Map();
    ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && this.pending.has(msg.id)) {
        const { res, rej } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        msg.error ? rej(new Error(JSON.stringify(msg.error))) : res(msg.result);
      } else if (msg.method) this.consume(msg);
    });
  }
  send(method, params = {}, sessionId) {
    const id = ++this.id;
    return new Promise((res, rej) => {
      this.pending.set(id, { res, rej });
      this.ws.send(JSON.stringify({ id, method, params, sessionId }));
    });
  }
  consume(m) {
    if (m.method === 'Runtime.consoleAPICalled') {
      logs.push(`[${m.params.type}] ` + m.params.args.map((a) => (a.value !== undefined ? String(a.value) : a.description || a.type)).join(' '));
    } else if (m.method === 'Runtime.exceptionThrown') {
      const e = m.params.exceptionDetails;
      logs.push(`[EXCEPTION] ${e.exception?.description || e.text}\n  at ${e.url}:${e.lineNumber}`);
    } else if (m.method === 'Log.entryAdded') {
      const e = m.params.entry;
      if (e.level === 'error') logs.push(`[log:error] ${e.text} ${e.url || ''}`);
    }
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitForDevTools(timeoutMs = 40000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/json/version`);
      if (res.ok) return res.json();
    } catch {
      /* not bound yet */
    }
    if (Date.now() > deadline) throw new Error(`devtools never bound on :${PORT}`);
    await sleep(250);
  }
}

async function main() {
  // witness / canary 这两腿不连 Chrome：它们是"页面读数的对照组"，必须先能独立跑起来。
  if (cmd === 'witness') {
    const rounds = String(rest || '0').split(',');
    let out;
    if (rounds.length > 1) {
      const map = {};
      for (const r of rounds) map[String(Number(r))] = await nodeWitnessOf(arg, Number(r));
      out = { tier: arg, multi: true, rounds: map };
    } else {
      out = await nodeWitnessOf(arg, Number(rounds[0]));
    }
    console.log(JSON.stringify(out));
    process.exit(0);
  }
  if (cmd === 'canary') {
    // 交不出负样本 ⇒ **非 0 退出**：verify.sh 那张表会把这一腿记成 RUNBAD，
    // 而不是"少了几条断言但仍然绿"。宁可这条腿不交，也不交一张假装跑过的。
    const j = await canaryWit(arg, Number(rest || '0'));
    console.log(JSON.stringify(j));
    if (!j.ok) console.error('canary 证人失败：' + j.why + ' 缺 ' + JSON.stringify(j.missing));
    process.exitCode = j.ok ? 0 : 1;
    return;
  }

  const info = await waitForDevTools();
  const ws = new WebSocket(info.webSocketDebuggerUrl);
  await new Promise((res, rej) => {
    ws.addEventListener('open', res);
    ws.addEventListener('error', rej);
  });
  const cdp = new CDP(ws);

  let list = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
  if (cmd === 'open') {
    for (const t of list) {
      if (t.type === 'page' && isOurs(t.url)) {
        try {
          await cdp.send('Target.closeTarget', { targetId: t.id || t.targetId });
        } catch { /* already gone */ }
      }
    }
    await sleep(300);
    list = [];
  }
  const existing = cmd === 'open' ? null : list.find((t) => t.type === 'page' && isOurs(t.url));
  let sessionId;
  if (existing) {
    ({ sessionId } = await cdp.send('Target.attachToTarget', { targetId: existing.id || existing.targetId, flatten: true }));
  } else {
    const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
    ({ sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true }));
  }

  await cdp.send('Runtime.enable', {}, sessionId);
  await cdp.send('Log.enable', {}, sessionId);
  await cdp.send('Page.enable', {}, sessionId);
  if (VIEWPORT) {
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: VIEWPORT.width,
      height: VIEWPORT.height,
      deviceScaleFactor: VIEWPORT.dpr,
      mobile: VIEWPORT.mobile,
    }, sessionId);
  }

  const evaluate = async (expression) => {
    const r = await cdp.send(
      'Runtime.evaluate',
      { expression, returnByValue: true, awaitPromise: true, timeout: 900000 },
      sessionId
    );
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
    return r.result.value;
  };

  const navigate = async (url) => {
    await cdp.send('Page.navigate', { url }, sessionId);
    for (let i = 0; i < 120; i++) {
      const ready = await evaluate('document.readyState').catch(() => 'loading');
      if (ready === 'complete') break;
      await sleep(100);
    }
  };

  /** 一次 CDP 真指针点击：move → press → release，坐标就是页面量到的 clientX/clientY。 */
  const clickAt = async (x, y) => {
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none' }, sessionId);
    await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1, buttons: 1 }, sessionId);
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1, buttons: 0 }, sessionId);
  };

  /**
   * key 名 → CDP 需要的 code / 虚拟键码 / text。走的是 Chrome 自己那套 WebKitKeyboardCodes，
   * 派发进来的事件 isTrusted=true、target = document.activeElement —— 这才叫**真键盘通道**：
   * 页面的 keydown 处理读的是 ev.target，而 ev.target 由浏览器的焦点系统决定，不由测试决定。
   */
  const KEYDESCRIPTOR = {
    ArrowLeft: { code: 'ArrowLeft', vk: 37 },
    ArrowUp: { code: 'ArrowUp', vk: 38 },
    ArrowRight: { code: 'ArrowRight', vk: 39 },
    ArrowDown: { code: 'ArrowDown', vk: 40 },
    Enter: { code: 'Enter', vk: 13, text: '\r' },
    ' ': { code: 'Space', vk: 32, text: ' ' },
    Tab: { code: 'Tab', vk: 9 },
    Backspace: { code: 'Backspace', vk: 8 },
    Delete: { code: 'Delete', vk: 46 },
  };

  /** 一次 CDP 真按键：keyDown（可打印键带 text，浏览器自己补 char/输入）+ keyUp。
   *  未知键名直接抛：静默少派一个键就是假绿。 */
  const pressKey = async (name) => {
    const d = KEYDESCRIPTOR[name];
    if (!d) throw new Error(`键盘腿要派的键不在表里：${JSON.stringify(name)}`);
    const base = { key: name, code: d.code, windowsVirtualKeyCode: d.vk, nativeVirtualKeyCode: d.vk };
    if (d.modifiers) base.modifiers = d.modifiers;
    const txt = d.text ? { text: d.text } : {};
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', ...base, ...txt }, sessionId);
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', ...base }, sessionId);
  };

  /**
   * 续局腿的**刷新前证人**：node 在派发 Page.reload **之前**自己跑一次 Runtime.evaluate。
   * 只有 node 手里有这份东西，刷新后场景才可能拿到"不是这个文档给的"值 —— 同文档片段跳转冒充重载
   * 那一类假绿就死在这一句上（页面自己报的读数它也能报对，node 取的这份它报不出新的 timeOrigin）。
   * 顺手把哨兵串设进旧上下文：新文档里读不到它 = JS 上下文真的换了。
   */
  const SENTINEL = '__tasquarePreReloadSentinel';
  const preReloadWitness = async () => {
    const raw = await evaluate(`(() => {
      window.${SENTINEL} = ${JSON.stringify('tasquare-verify-pre-reload')};
      const s = window.tasquare && window.tasquare.state ? window.tasquare.state() : null;
      if (!s) throw new Error('刷新前证人取不到：window.tasquare.state() 是空的');
      const t = (id) => { const e = document.getElementById(id); return e ? String(e.textContent) : '<无节点>'; };
      return JSON.stringify({
        sentinel: window.${SENTINEL},
        timeOrigin: String(performance.timeOrigin),
        href: location.href,
        seed: s.seed, tier: s.tier, round: s.round, ok: s.ok, face: s.face,
        counts: s.counts, status: t('status'), seedline: t('seedline'),
        savedKeys: Object.keys(localStorage).filter((k) => k.indexOf('tasquare:') === 0),
      });
    })()`);
    return JSON.parse(raw);
  };

  /** 一次**真**刷新：Page.reload + 等文档重新 complete + 重新上膛（新文档的 window 是空的）。 */
  const reloadDocument = async () => {
    await cdp.send('Page.reload', { ignoreCache: false }, sessionId);
    for (let i = 0; 120 > i; i++) {
      const ready = await evaluate('document.readyState').catch(() => 'loading');
      if (ready === 'complete') break;
      await sleep(100);
    }
    await arm();
  };

  const install = async () => {
    const src = fs.readFileSync(path.join(__dirname, 'scenarios.js'), 'utf8');
    await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: src }, sessionId);
    // 先落到同 origin 的 404：本仓的档位/局号在 fragment 里，只差 fragment 的 Page.navigate 不是导航
    await navigate(`${BASE.replace(/\/$/, '')}/tasquare-probe-404`);
    await navigate(process.env.NAV_URL || BASE);
    await arm();
  };

  /**
   * 每次导航之后重新上膛：headless 会把页面报成 hidden，等重绘的场景就会对着一个假装在后台的 tab 超时；
   * 期望值走 window.__expectRaw（原样字符串），场景里自己 JSON.parse。
   * **续局腿刷新之后也要走这里**：新文档的 window 是空的，__expectRaw 不上膛就没有期望值。
   */
  const arm = async () => {
    await evaluate(`Object.defineProperty(document,'hidden',{get:()=>false,configurable:true});
      Object.defineProperty(document,'visibilityState',{get:()=>'visible',configurable:true});
      window.__expectRaw = ${JSON.stringify(rest || 'null')}; 'ok'`);
  };

  const call = (name, roundArg) => `(async()=>{
      if (!window.__scn) throw new Error('scenarios.js never installed');
      const fn = window.__scn[${JSON.stringify(name)}];
      if (typeof fn !== 'function') {
        throw new Error('没有这个场景：' + ${JSON.stringify(name)} + '（已注册：' + Object.keys(window.__scn).join(',') + '）');
      }
      const r = await fn(${roundArg || 'undefined'});
      return JSON.stringify(r);
    })()`;

  /** 页面交回的行 + 需要时才跑的 node 证人，合成一条 RESULT 打在最后。 */
  const emit = async (out) => {
    const parsed = JSON.parse(out);
    if (parsed && parsed.nodeWitness === 'crossEngineFaces') {
      const samples = parsed.samples || [];
      const { rows, extra } = await crossEngineRows(samples);
      const all = (parsed.rows || []).concat(rows);
      parsed.rows = all;
      parsed.fail = all.filter((r) => !r.pass).length;
      parsed.matched = `${extra.matched}/${extra.compared}`;
      parsed.goldenPins = extra.goldens;
      delete parsed.samples;                      // 20 组原文回给报告就够了，别塞进 RESULT 行
    }
    if (logs.length) console.error(logs.slice(-40).join('\n'));
    console.log('RESULT ' + JSON.stringify(parsed));
  };

  if (cmd === 'open') {
    await navigate(arg || BASE);
    await sleep(400);
    console.log('opened ' + (arg || BASE) + '\n' + (logs.join('\n') || '(no console output)'));
  } else if (cmd === 'eval') {
    if (rest !== 'nonav') await navigate(BASE);
    const out = await evaluate(arg);
    console.log(typeof out === 'string' ? out : JSON.stringify(out));
  } else if (cmd === 'scenario') {
    await install();
    await emit(await evaluate(call(arg)));
  } else if (cmd === 'interact') {
    await install();
    const max = Number(process.env.MAX_ROUNDS || 12);
    let final = null;
    let carry = null;                     // 页面交回、**node 保管**、下一回合再送回去的东西（续局的证人就走这条路）
    let keptRows = [];                    // 刷新**前**那几回合的断言：旧文档一死页内数组就没了，靠 node 兜住
    for (let round = 0; round < max; round++) {
      const ctxParts = [`round:${round}`];
      if (carry !== null) ctxParts.push(`carry:${JSON.stringify(carry)}`);
      final = JSON.parse(await evaluate(call(arg, `{${ctxParts.join(',')}}`)));
      if (final.carry) carry = Object.assign({}, carry || {}, final.carry);
      const pending = final && final.pending;
      const keys = final && final.pendingKeys;
      if (final && final.reload) {
        if (Array.isArray(final.rows)) keptRows = keptRows.concat(final.rows);   // 交回来的断言先收下再刷新
        // 刷新**之前**先在旧上下文里取证人（node 自己取的那一份，页面再也报不出第二个 timeOrigin）
        const pre = await preReloadWitness();
        carry = Object.assign({}, carry || {}, {
          pre, pageReported: final.pre || null,
          reloadMode: typeof final.reload === 'string' ? 'fragment-sabotage' : 'page-reload',
        });
        if (typeof final.reload === 'string' && final.reload.startsWith('fragment:')) {
          // 阴性自证专用：**同文档**片段导航（不是导航：window 还在、存档根本没被读）。
          // 真的续局腿绝不该走到这一支；走到就是让场景那条"新文档"证人当场红。
          await evaluate(`location.href = ${JSON.stringify(final.reload.slice('fragment:'.length))}`);
          await sleep(200);
        } else {
          await reloadDocument();
        }
        continue;
      }
      if (keys && keys.length) {
        for (const k of keys) await pressKey(String(k && k.key));
        await sleep(60);                  // 让 keydown 处理与重画落地，再谈下一回合的读数
        final.pendingKeysCount = (final.pendingKeysCount || 0) + keys.length;
        continue;
      }
      if (!pending || !pending.length) break;
      for (const p of pending) await clickAt(Number(p.x), Number(p.y));
      await sleep(80);                       // 让 click 处理与重画落地，再谈下一回合的读数
      final.pendingCount = (final.pendingCount || 0) + pending.length;
    }
    if (!final) throw new Error('interact 一个回合都没跑成');
    if (final.pending && final.pending.length) throw new Error(`interact 超过 ${max} 回合还没走完（还欠 ${final.pending.length} 次点击）`);
    if (final.pendingKeys && final.pendingKeys.length) throw new Error(`interact 超过 ${max} 回合还没走完（还欠 ${final.pendingKeys.length} 次按键）`);
    if (final.reload) throw new Error(`interact 超过 ${max} 回合还没走完（刷新那一步没走到）`);
    // 把刷新前那几回合的断言并回来：条数是这条腿的一部分，掉了文档不能跟着掉。
    final.rows = keptRows.concat(final.rows || []);
    final.fail = final.rows.filter((r) => !r.pass).length;
    await emit(JSON.stringify(final));
  } else if (cmd === 'shot') {
    await cdp.send('Page.bringToFront', {}, sessionId);
    await sleep(250);
    const { data } = await cdp.send('Page.captureScreenshot', { format: 'png' }, sessionId);
    fs.mkdirSync(path.dirname(arg), { recursive: true });
    fs.writeFileSync(arg, Buffer.from(data, 'base64'));
    console.log('wrote ' + arg);
  } else if (cmd === 'logs') {
    console.log(logs.join('\n') || '(clean)');
  } else {
    console.error('unknown command: ' + cmd);
    process.exit(64);
  }
  ws.close();
  process.exit(0);
}

main().catch((err) => {
  console.error('ERROR ' + (err.message || err));
  if (logs.length) console.error(logs.slice(-12).join('\n'));
  process.exit(1);
});
