// 持久层 · 两段式解码（坏一条只丢那一条）
//
// 为什么要有"两段"：本仓的存档是**一个数组**（最近若干局的局号、用时、盘面串）加**每局一条**
// 盘面记录。第一版把所有解码写成 `Object.assign(默认值, JSON.parse(raw))` —— 那只要数组里
// 有一条是 `null` 或字段类型不对，解码就抛异常，整份档一起丢，页面在开机第一步就冻住。
// 实测口径：
//   第一段（拆包）：整包 JSON.parse 失败 ⇒ 只能全丢（没有更细的信息可救了），记 bad='json'。
//   第二段（逐条）：每条**各自** try/catch + 逐字段校验 ⇒ 坏的那条进 dropped，其余照常回来。
//   越界值不判死：夹回边界并记 clamped（"用时 1e9 秒"这种脏数字不该让那一局消失）。
//
// 盘面记录的键名与形状**不改**：`tasquare:v1:<tier>:<round>` → `{seed, marks}`，
// 浏览器闸的续局腿就是按这个形状取证的（改了它等于把那条腿拆了）。

import { tierOf } from '../engine/generate.js';

export const BOARD_PREFIX = 'tasquare:v1:';
export const PREFS_KEY = 'tasquare:prefs:v1';
export const INDEX_KEY = 'tasquare:index:v1';
export const INDEX_MAX = 24;                    // 最近局索引最多留这么多条
export const ELAPSED_MAX = 6 * 3600;            // 单局用时上限（超过就是脏数字）

/** 浏览器默认持久层：写成函数包一层，是为了让闸能塞一个内存 Map 进来跑同一条解码路径。 */
export const browserStorage = {
  lastError: null,
  // localStorage 在 Safari 隐私模式、配额耗尽、以及"站点被限制跨站跟踪"下**会抛**（不是返回 null）。
  // 抛在解码之前就等于开机冻住，所以异常在这里就吃掉：读给 null，写给 false，原因留在 lastError 上。
  getItem: (k) => {
    try { return localStorage.getItem(k); } catch (e) { browserStorage.lastError = `getItem:${e && e.name}`; return null; }
  },
  setItem: (k, v) => {
    try { localStorage.setItem(k, v); return true; } catch (e) { browserStorage.lastError = `setItem:${e && e.name}`; return false; }
  },
  removeItem: (k) => {
    try { localStorage.removeItem(k); return true; } catch (e) { browserStorage.lastError = `removeItem:${e && e.name}`; return false; }
  },
};

export const boardKey = (tierKey, round) => `${BOARD_PREFIX}${tierKey}:${round}`;

/** 盘面记录（每局一条）的第二段解码：形状不对就整条丢，不抛。 */
export function decodeBoard(raw, expectLen) {
  if (typeof raw !== 'string' || !raw) return null;
  let s;
  try { s = JSON.parse(raw); } catch { return null; }
  if (!s || typeof s !== 'object' || Array.isArray(s)) return null;
  if (typeof s.marks !== 'string') return null;
  if (expectLen != null && s.marks.length !== expectLen) return null;   // 尺寸对不上就是串盘了
  if (!/^[012]+$/.test(s.marks)) return null;
  if (typeof s.seed !== 'string' || !/^[0-9a-z._-]+$/i.test(s.seed)) return null;
  return { seed: s.seed, marks: s.marks };
}

/** 索引里一条记录的第二段解码；返回 {rec} 或 {bad:原因}，越界值走 clamped。 */
export function decodeRecord(rec) {
  try {
    if (!rec || typeof rec !== 'object' || Array.isArray(rec)) return { bad: 'not-object' };
    const { tier, round, seed } = rec;
    if (typeof tier !== 'string' || !tierOf(tier)) return { bad: 'tier' };
    if (!Number.isInteger(round) || round < 0) return { bad: 'round' };
    if (typeof seed !== 'string' || !/^[0-9a-z._-]+$/i.test(seed)) return { bad: 'seed' };
    let clamped = 0;
    let elapsed = rec.elapsed;
    if (elapsed === undefined || elapsed === null) elapsed = 0;
    if (typeof elapsed !== 'number' || !Number.isFinite(elapsed)) return { bad: 'elapsed-type' };
    if (elapsed < 0) { elapsed = 0; clamped++; }
    if (elapsed > ELAPSED_MAX) { elapsed = ELAPSED_MAX; clamped++; }
    let marks = null;
    if (rec.marks !== undefined) {
      const t = tierOf(tier);
      marks = decodeBoard(JSON.stringify({ seed, marks: rec.marks }), t.h * t.w);
      if (!marks) return { bad: 'marks' };
    }
    return { rec: { tier, round, seed, elapsed, marks: marks ? marks.marks : null, clamped } };
  } catch (e) {
    return { bad: `throw:${e && e.message ? e.message : e}` };   // 抛出来也只脏这一条
  }
}

/** 整份索引：第一段拆包，第二段逐条。坏一条只丢那一条 —— 这条不变量由 tools/session-test.mjs 钉住。 */
export function decodeIndex(raw) {
  const out = { records: [], dropped: [], total: 0, bad: null, clamped: 0 };
  if (typeof raw !== 'string' || !raw) return out;
  let parsed;
  try { parsed = JSON.parse(raw); } catch { out.bad = 'json'; return out; }
  if (!Array.isArray(parsed)) { out.bad = 'not-array'; return out; }
  out.total = parsed.length;
  parsed.forEach((rec, i) => {
    const r = decodeRecord(rec);
    if (r.bad) out.dropped.push({ i, why: r.bad });
    else { out.records.push(r.rec); out.clamped += r.rec.clamped; }
  });
  return out;
}

/** 偏好（静音/减少动效/档位）：逐字段各自验，坏一个字段只退回那一个字段的默认值。 */
export function decodePrefs(raw, defaults = { muted: false, hintAuto: false, tier: null }) {
  const out = { ...defaults, badFields: [] };
  if (typeof raw !== 'string' || !raw) return out;
  let p;
  try { p = JSON.parse(raw); } catch { out.badFields.push('json'); return out; }
  if (!p || typeof p !== 'object' || Array.isArray(p)) { out.badFields.push('shape'); return out; }
  for (const k of Object.keys(defaults)) {
    const v = p[k];
    if (v === undefined) { out.badFields.push(`${k}:missing`); continue; }
    if (k === 'tier') { if (v === null || tierOf(v)) out[k] = v; else out.badFields.push(k); continue; }
    if (typeof v === typeof defaults[k]) out[k] = v;
    else out.badFields.push(k);
  }
  return out;
}

/** 读写门面：storage 可注入（浏览器给 browserStorage，闸给内存 Map 包装）。 */
export function makeStore(storage) {
  const has = () => !!storage && typeof storage.getItem === 'function' && typeof storage.setItem === 'function';
  return {
    available: has(),
    board(tierKey, round) {
      if (!has()) return null;
      const t = tierOf(tierKey);
      return decodeBoard(storage.getItem(boardKey(tierKey, round)), t ? t.h * t.w : null);
    },
    writeBoard(tierKey, round, rec) {
      if (!has()) return false;
      storage.setItem(boardKey(tierKey, round), JSON.stringify(rec));
      return true;
    },
    index() {
      if (!has()) return { records: [], dropped: [], total: 0, bad: null, clamped: 0 };
      return decodeIndex(storage.getItem(INDEX_KEY));
    },
    writeIndex(records) {
      if (!has()) return false;
      const slim = records.slice(0, INDEX_MAX)
        .map((r) => ({ tier: r.tier, round: r.round, seed: r.seed, elapsed: r.elapsed }));
      storage.setItem(INDEX_KEY, JSON.stringify(slim));
      return true;
    },
    prefs() {
      if (!has()) return { muted: false, hintAuto: false, tier: null, badFields: [] };
      return decodePrefs(storage.getItem(PREFS_KEY));
    },
    writePrefs(p) {
      if (!has()) return false;
      storage.setItem(PREFS_KEY, JSON.stringify({ muted: !!p.muted, hintAuto: !!p.hintAuto, tier: p.tier || null }));
      return true;
    },
  };
}
