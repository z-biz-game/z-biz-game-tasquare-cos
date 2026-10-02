// 动效与时钟层 · 无 DOM —— 暂停、重开、reduceMotion、帧率无关这四条判据都住在这里
//
// 为什么单独一个文件（而不是写在 app.js 里）：这条层必须能在 node 里被逐字段对拍
// （tools/session-test.mjs 拿 30/60/120Hz 三档喂同一个虚拟时长）。一旦它依赖 DOM 或 rAF，
// "帧率无关"就只剩"我看代码觉得是"这一种说法。
//
// 三条口径写死在这里：
//   ① **定步长累加器**：帧 dt 只进 `accum += dt` 这一行；逐实体积分一律吃 SIM_STEP。
//      于是 30/60/120Hz 下每一步的 s 完全相同 —— 位移/阻尼/概率不随刷新率改变语义。
//      （阻尼与概率仍写成 `Math.pow(k, s * 60)`：将来谁改步长，它还是对的。）
//   ② **暂停 = 一步都不跑**：paused 时 tick 直接返回，累加器既不增长也不被消费，
//      思考时长 elapsed 也不增长。恢复后不补帧（不拿墙钟差去追步数）。
//   ③ **随机只用内置 LCG**：墨点溅射的角度/寿命要可复现，`Math.random()` 会把三档对拍
//      变成掷骰子（那把尺子就再也判不了任何东西）。
//   ④ reduceMotion 是真的分支：命中时一个粒子都不生成（suppressed 计数会走），
//      时钟与涟漪仍推进 —— 关掉的是"动"，不是"反馈"。

export const SIM_STEP = 1 / 60;          // 定步长（秒）：所有逐实体积分吃它
export const MAX_FRAME_DT = 0.25;        // 一帧最多补 0.25 秒：切后台回来不追帧（追帧=一次性几百步）
export const RIPPLE_LIFE = 0.55;         // 涟漪寿命（秒）
export const SPARK_LIFE = 0.9;
const SPARK_DAMP = 0.93;                 // 每 1/60 秒的速度阻尼
const GRAVITY = 1.15;                    // 墨点下落（格/秒²，坐标是"格"为单位，与 --cell 无关）
const SPARK_PER_MARK = 7;                // 每次落子的墨点数（0 号是中心那滴）
const SPARK_CHANCE = 0.35;               // 每步给每个墨点再甩一滴的概率（写成 pow 形式）

/** 内置 LCG（Numerical Recipes 的那组常数）：同种子 ⇒ 同序列，跨帧率也同序列。 */
export function makeLcg(seed = 1) {
  let s = (seed >>> 0) || 1;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/**
 * @param reducedMotion 起手是否命中 prefers-reduced-motion: reduce
 * @param seed          随机种子（对拍要固定，默认按局号传进来）
 */
export function makeMotion({ reducedMotion = false, seed = 20260930 } = {}) {
  const rnd = makeLcg(seed);
  const st = {
    running: false, paused: false, reduced: !!reducedMotion,
    elapsed: 0,        // 思考时长（秒）：只有 running && !paused 才走
    animClock: 0,      // 视觉时钟（秒）：paused 时停
    accum: 0,          // 未消费的帧 dt
    steps: 0,          // 定步长跑了多少步
    ripples: [],       // {i, age, kind}
    sparks: [],        // {x, y, vx, vy, age, r}
    spawned: 0,        // 生成过的墨点数（reduceMotion 命中时不涨）
    suppressed: 0,     // 因 reduceMotion 被压掉的生成请求数
    events: 0,         // 落子/擦除次数
  };

  /** 一步：所有位移/阻尼/概率都吃 s（= SIM_STEP），不吃帧 dt。 */
  function step(s) {
    st.steps++;
    st.animClock += s;
    if (st.running && !st.paused) st.elapsed += s;

    for (const r of st.ripples) r.age += s;
    if (st.ripples.length) st.ripples = st.ripples.filter((r) => r.age < RIPPLE_LIFE);

    if (st.sparks.length) {
      const damp = Math.pow(SPARK_DAMP, s * 60);       // 阻尼按 60Hz 基准换算到本步
      const extra = 1 - Math.pow(1 - SPARK_CHANCE, s * 60);  // 概率同理（步长变了也不会改语义）
      const next = [];
      for (const p of st.sparks) {
        p.age += s;
        if (p.age >= SPARK_LIFE) continue;
        p.vy += GRAVITY * s;                            // x += v*dt 的形状
        p.vx *= damp;
        p.vy *= damp;
        p.x += p.vx * s;
        p.y += p.vy * s;
        p.r = Math.max(0.02, 0.09 * (1 - p.age / SPARK_LIFE));
        next.push(p);
        if (rnd() < extra && next.length < 400) {         // 上限：一屏墨点不许无界增长
          st.spawns_cap = (st.spawns_cap || 0) + 1;
          next.push(mkSpark(p.x, p.y, (rnd() - 0.5) * 2.2, -rnd() * 1.4));
          st.spawned++;
        }
      }
      st.sparks = next;
    }
  }

  function mkSpark(x, y, vx, vy) {
    return { x, y, vx, vy, age: 0, r: 0.09 };
  }

  /** 帧入口：dt 单位是秒（rAF 的毫秒差在这里换算）。 */
  function tick(dt) {
    if (st.paused) return st;                            // 暂停：一步都不跑，累加器也不涨
    const d = Math.min(Math.max(Number(dt) || 0, 0), MAX_FRAME_DT);
    st.accum += d;                                       // ← 阴性对照钉在这一行
    let guard = 0;
    while (st.accum >= SIM_STEP && guard++ < 2000) {
      st.accum -= SIM_STEP;
      step(SIM_STEP);
    }
    return st;
  }

  /** 落子/擦除的事件：涟漪一定记（它是"操作有回应"的那半），墨点只在没开 reduceMotion 时生成。 */
  function emit(cell, { row = 0, col = 0, kind = 'mark' } = {}) {
    st.events++;
    st.ripples.push({ i: cell, row, col, age: 0, kind });
    if (st.reduced) { st.suppressed++; return 0; }
    let n = 0;
    for (let k = 0; k < SPARK_PER_MARK; k++) {
      const a = rnd() * Math.PI * 2;
      const sp = 0.35 + rnd() * 1.25;
      st.sparks.push(mkSpark(col + 0.5, row + 0.5, Math.cos(a) * sp, Math.sin(a) * sp - 0.5));
      n++;
    }
    st.spawned += n;
    return n;
  }

  function start() { st.running = true; return st; }
  function pause() { st.paused = true; return st; }
  function resume() { st.paused = false; return st; }   // 不追帧：accum 里最多剩一帧的零头
  function setReducedMotion(on) { st.reduced = !!on; if (st.reduced) st.sparks.length = 0; return st; }

  /** 重开：时钟、累加器、涟漪、墨点、计数**全部**归零（漏一个就是"重开后又接着上一局的动效"）。 */
  function reset() {
    st.running = false; st.paused = false;
    st.elapsed = 0; st.animClock = 0; st.accum = 0; st.steps = 0;
    st.ripples.length = 0; st.sparks.length = 0;
    st.spawned = 0; st.suppressed = 0; st.events = 0; st.spawns_cap = 0;
    return st;
  }

  /** 对拍读数：全是可逐字段比较的标量（数组只给数量与质心，不给内容 —— 内容比的是指纹）。 */
  function snapshot() {
    let sx = 0, sy = 0, sa = 0;
    for (const p of st.sparks) { sx += p.x; sy += p.y; sa += p.age; }
    let ra = 0;
    for (const r of st.ripples) ra += r.age;
    return {
      steps: st.steps, elapsed: st.elapsed, animClock: st.animClock, accum: st.accum,
      ripples: st.ripples.length, sparks: st.sparks.length,
      sparkSumX: sx, sparkSumY: sy, sparkAgeSum: sa, rippleAgeSum: ra,
      spawned: st.spawned, suppressed: st.suppressed, events: st.events,
    };
  }

  return { st, tick, step, emit, start, pause, resume, reset, setReducedMotion, snapshot };
}
