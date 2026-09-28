// 独立通道：完全忽略线索**数值**，只按"候选方形的所有合法打包"枚举涂黑，
// 再拿规则模型 verify() 逐张判读数。它与 counter.js 的搜索形状没有一处相同（那里是
// 线索驱动 + 子集和 + 封口 + 连通剪枝），所以两边数出不同个数时，红的是裁判。
import { squareTable, verify, FREE } from '../js/engine/rules.js';

export function packingCount(f, o, cap = Infinity) {
  const T = squareTable(f, o);
  const S = T.squares, n = f.h * f.w;
  const used = new Uint8Array(n);
  const acc = [];
  let count = 0, examined = 0, stoppedEarly = false;
  const seen = new Set();
  (function rec(k) {
    if (stoppedEarly) return;
    if (k === S.length) {
      examined++;
      if (count >= cap) { stoppedEarly = true; return; }
      const bs = new Uint8Array(n);
      for (const q of acc) for (const i of q.cells) bs[i] = 1;
      const key = bs.join('');
      if (seen.has(key)) return;                     // 同一涂黑由两种打包得到 => 记一次
      seen.add(key);
      if (verify(f, bs, o).length === 0) count++;
      return;
    }
    rec(k + 1);
    if (stoppedEarly) return;
    const q = S[k];
    for (const i of q.cells) if (used[i]) return;
    for (const i of q.nb) if (used[i]) return;       // [R3] 共边相邻
    for (const i of q.cells) used[i] = 1;
    acc.push(q);
    rec(k + 1);
    acc.pop();
    for (const i of q.cells) used[i] = 0;
  })(0);
  return { count, examined, stoppedEarly, dupDraws: 0 };
}

/** 同一通道的解集合（给"裁判交回的解 ∈ 打包集合"用） */
export function packingBlacks(f, o, cap = Infinity) {
  const T = squareTable(f, o);
  const S = T.squares, n = f.h * f.w;
  const used = new Uint8Array(n);
  const acc = [];
  const out = [];
  const seen = new Set();
  (function rec(k) {
    if (out.length >= cap) return;
    if (k === S.length) {
      const bs = new Uint8Array(n);
      for (const q of acc) for (const i of q.cells) bs[i] = 1;
      const key = bs.join(',');
      if (!seen.has(key) && verify(f, bs, o).length === 0) { seen.add(key); out.push(bs); }
      return;
    }
    rec(k + 1);
    const q = S[k];
    for (const i of q.cells) if (used[i]) return;
    for (const i of q.nb) if (used[i]) return;
    for (const i of q.cells) used[i] = 1;
    acc.push(q);
    rec(k + 1);
    acc.pop();
    for (const i of q.cells) used[i] = 0;
  })(0);
  return out;
}
export const isFree = (f, i) => f.c[i] === FREE;
