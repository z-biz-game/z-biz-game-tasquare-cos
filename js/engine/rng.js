// 随机数 · 本仓唯一入口（FNV-1a 压 seed → splitmix32）
//
// 全仓只有这一个 PRNG，只吃字符串。任何"看上去更随机"的写法（Math.random / Date.now /
// new Date / getRandomValues / loadavg / Object 遍历序）一律不许出现在判定路径上：门禁要在
// 三台机器上得到同一批盘，浏览器和 node 也要给同一张，否则出题器回填进 TIERS 的分位表就是
// 一张不能对账的读数。默认 seed 也不许由日期派生 —— 那等于每天换一批盘。
//
// seed 串形状：`tasquare|<档位键>|<局号>`。档位键带尺寸（本仓的档位不是"一档一尺寸"：
// 8x8 独占两档，难度由**印刷线索数**而不是格子数决定，见 generate.js 的 TIERS），局号允许
// 是任意字符串（UI 用递增整数）。produce() 吃的是**整串**，不自己拼前缀。
//
// 算法与 hidato/zebra 两仓逐行相同（同一个 0x6d2b79f5 增量和三段 finalizer）：不是为了让
// 三仓画出同一张盘（题材不同，本来也不同），是为了"换仓不用重新理解 seed"。
//
// 洗牌必须一次性把随机数抽完，比较器里一个都不许抽：node 与 Chrome 的 Array#sort 对相等
// 元素的次序不同（V8 长数组走 TimSort、短的用插入排序），比较器吃随机数会让两边挑出不同的盘。
// 本仓两处带排序的抽样（counter 的 MRV 序、generate 的铺块序）都把随机键在 sort **之前**抽成
// 数据，比较器是纯函数（MRV 序的比较键是候选数，与随机无关，且末级 tie-break 用格号）。

/** 32 位 FNV-1a：把任意长度的 seed 串压成一个 32 位起点。偏移量/质数不可改。 */
export function hash32(str) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

/**
 * 返回一个**裸函数** rnd()：调用点消费顺序就是判定顺序，多包一层 {next,int,pick} 对象不会
 * 改变数值流，但会让人怀疑"少抽了一次"。需要 int/pick 的调用方自己写 `(rnd() * k) | 0`。
 */
export function makeRng(seedStr) {
  let a = hash32(String(seedStr));
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | t);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Fisher–Yates（原地交换版）：抽样的次数只取决于长度，与元素值/比较无关，
 * 所以换机器、换 sort 实现都得到同一个序。删线索的次序就靠它钉住。
 */
export function shuffled(list, rnd) {
  const a = list.slice();
  for (let i = a.length - 1; i > 0; i--) { const j = (rnd() * (i + 1)) | 0; const t = a[i]; a[i] = a[j]; a[j] = t; }
  return a;
}

/** 生产 seed 串：档位在前、局号在后。 */
export function seedOf(tierKey, seed) {
  const k = String(tierKey);
  if (!/^[0-9a-z][0-9a-z._-]*$/i.test(k)) throw new Error(`档位标识不合规范：${k}`);
  return `tasquare|${k}|${seed}`;
}
