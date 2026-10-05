#!/usr/bin/env node
// 母题闸 · 图标上那两句话必须由真引擎认账，位图必须是盘上真实的图
//
// 存在理由：`assets/gen/make_art.py` 画的是**一张真题面**（favicon、app 图标、1024 商店图、
// 社交卡、标题静图全都从同一张母图缩出来）。它自证的那句"线索数字不是编的，按规则现算"
// 在 python 一侧闭环，而规则的本体在 `js/engine/rules.js` —— 两边各写一遍就一定会分叉。
// 本仓实测过分叉的两种形状（都是这一道闸现在钉住的东西）：
//   · python 数的是"四邻里有几个黑格"，引擎默认读数却是 `readA='area'`（R4：邻到的黑区**面积**之和）
//     ⇒ 邻着 2×2 那块的格子该印 4，图标上印的是 1；裁判对图标自己报 4 条 R4。
//   · `?` 写死在 (3,3)（社交卡上写死在 (6,6)），而那一格四邻没有黑格 ⇒ 违反它自己想教的 R5。
// 所以这里不重新实现任何规则：题面 token 由 make_art.py 导出到 `assets/gen/motif.json`，
// 本闸把它们**喂给真引擎**（makeFace / verify / countSolutions），口径一分叉就红。
//
// 跑法：  node tools/motif-test.mjs
//
// 每段都写了"什么改动会让这段红"：
//   §1 题面自洽      make_art.py 的读数口径漂回"数黑格"、`?` 挪到零邻黑格的格子、黑区共边
//                    或白格被切开 ⇒ 引擎 verify() 交回 R1–R6 中任何一条。
//   §2 解可达        画上去的那张黑区不在裁判认得的解里（图与题面各说一套）⇒ 红。
//                    这一段**不**声称解唯一（母题是插图，实测 count≥2），所以也不许被改成声称唯一。
//   §3 阴性对照      把两条口径重新合并（python 改回数黑格、`?` 改回写死角落）必须让 §1 红；
//                    这里就是拿那两个变异体各跑一次，量不到东西就红。
//   §4 位图真实      manifest/index.html/sw.js 引用的路径不在盘上、0 字节、SVG 冒充 .png、
//                    IHDR 宽高与 manifest 声明的 sizes 不符 ⇒ 红。
//   §5 资产被消费    位图落盘但没人用（CSS 变量定义了没被引用、img 的 src 改掉）⇒ 红。

import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { DEFAULTS, QMARK, makeFace, verify } from '../js/engine/rules.js';
import { countSolutions } from '../js/engine/counter.js';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => readFileSync(path.join(REPO, rel), 'utf8');
const readBuf = (rel) => readFileSync(path.join(REPO, rel));

console.log('================================================================================');
console.log('TASQUARE MOTIF-TEST — 图标题面送进真引擎 / 位图形状与引用实测');
console.log(`node ${process.version} · 引擎默认读数 readA=${JSON.stringify(DEFAULTS.readA)} · allowSingle=${DEFAULTS.allowSingle}`);
console.log('================================================================================');

let checks = 0, fails = 0;
const ok = (gate, cond, detail = '') => {
  checks++;
  if (!cond) { fails++; console.log(`  FAIL ${gate}${detail ? ' :: ' + detail : ''}`); }
  else console.log(`  ok   ${gate}${detail ? ' :: ' + detail : ''}`);
};
const eq = (gate, got, want) => ok(gate, String(got) === String(want), `got=${got} want=${want}`);

const spec = JSON.parse(read('assets/gen/motif.json'));
const blacksOf = (h, w, blacks) => {
  const bs = new Uint8Array(h * w);
  for (const [r, c] of blacks) bs[r * w + c] = 1;
  return bs;
};
const NBR = [[-1, 0], [1, 0], [0, -1], [0, 1]];

// ---------------------------------------------------------------- §1 题面自洽
console.log('\n[§1 图标上那张题面，由真引擎逐条判 R1–R6]');
eq('§1 导出与引擎同一个读数口径（python 漂了就先在这里红）', spec.readA, DEFAULTS.readA);
for (const f of spec.faces) {
  const face = makeFace(f.face);
  const bs = blacksOf(f.h, f.w, f.blacks);
  const V = verify(face, bs);
  ok(`§1 ${f.name} 的题面 token 能被 makeFace 解析（多位数靠空格分列）`, face.h === f.h && face.w === f.w,
    `${face.h}×${face.w}`);
  eq(`§1 ${f.name} 对画出来的那张黑区零违规`, V.length, 0);
  if (V.length) console.log(`      ${V.map((v) => v.code + ' ' + v.msg).join('\n      ')}`);
  const qIdx = f.qmark[0] * f.w + f.qmark[1];
  eq(`§1 ${f.name} 的 \`?\` 确实进了 face（QMARK 哨兵，不是画上去的装饰）`, face.c[qIdx], QMARK);
  const qTouch = NBR.filter(([dr, dc]) => {
    const r = f.qmark[0] + dr, c = f.qmark[1] + dc;
    return r >= 0 && c >= 0 && r < f.h && c < f.w && bs[r * f.w + c];
  }).length;
  ok(`§1 ${f.name} 的 \`?\` 落在 ${f.qmark} 有 ${qTouch} 个黑邻格（R5 要求 ≥1）`, qTouch >= 1, `qTouch=${qTouch}`);
  const printed = Object.entries(f.clues).map(([k, v]) => {
    const [r, c] = k.split(',').map(Number);
    return face.c[r * f.w + c] === v;
  });
  eq(`§1 ${f.name} 印出的 ${printed.length} 条数字与 motif.json 的读数一一对上`,
    printed.filter(Boolean).length, printed.length);
}

// ---------------------------------------------------------------- §2 解可达
console.log('\n[§2 画出来的那张黑区，是裁判认得的解之一（不声称唯一）]');
for (const f of spec.faces) {
  const face = makeFace(f.face);
  const bs = blacksOf(f.h, f.w, f.blacks);
  const res = countSolutions(face, { limit: 8, wantSolutions: true });
  const key = Array.from(bs).join('');
  const inSet = res.solutions.some((s) => Array.from(s).join('') === key);
  ok(`§2 ${f.name} 裁判至少数到一个解`, res.count >= 1, `count=${res.count} nodes=${res.nodes} stopped=${res.stopped}`);
  ok(`§2 ${f.name} 图上那张黑区在裁判交回的解里`, inSet, `count=${res.count} 交出 ${res.solutions.length} 个解`);
  ok(`§2 ${f.name} 不声称唯一（母题是插图；count=${res.count}${res.stopped ? ' 且被上限截断' : ''}）`,
    true, `count=${res.count}`);
  const bad = res.solutions.filter((s) => verify(face, s).length).length;
  eq(`§2 ${f.name} 裁判交回的每个解都过 R1–R6`, bad, 0);
}

// ---------------------------------------------------------------- §3 阴性对照
console.log('\n[§3 阴性对照：两条本仓真踩过的口径分叉，必须让 §1 那把尺红]');
{
  const f = spec.faces.find((x) => x.name === 'master-4x4');
  const bs = blacksOf(f.h, f.w, f.blacks);
  // 变异体 A：python 旧口径 —— 数"四邻里有几个黑格"，而不是邻到的黑区面积之和。
  const cellCount = {};
  for (let r = 0; r < f.h; r++) for (let c = 0; c < f.w; c++) {
    if (bs[r * f.w + c]) continue;
    const n = NBR.reduce((a, [dr, dc]) => {
      const nr = r + dr, nc = c + dc;
      return a + (nr >= 0 && nc >= 0 && nr < f.h && nc < f.w && bs[nr * f.w + nc] ? 1 : 0);
    }, 0);
    if (n) cellCount[`${r},${c}`] = n;
  }
  const rowsA = f.face.map((row, r) => row.split(' ').map((t, c) => {
    const k = `${r},${c}`;
    return t === '?' ? '.' : (cellCount[k] !== undefined ? String(cellCount[k]) : t);
  }).join(' '));
  const VA = verify(makeFace(rowsA), bs);
  const differ = Object.entries(cellCount).filter(([k, v]) => f.clues[k] !== undefined && f.clues[k] !== v).length;
  ok(`§3 变异体 A（数黑格口径）必须报 R4：实测 ${VA.length} 条违规`, VA.length > 0
    && VA.every((v) => v.code === 'R4'), VA.map((v) => `${v.code}@${v.msg.split(' ')[1]}`).join(' '));
  eq(`§3 变异体 A 报的正是那些"面积 ≠ 黑邻数"的格子（${differ} 条，逐条不多不少）`,
    VA.length, differ);
  // 变异体 B：`?` 写死在零邻黑格的角落（母图原先的 (3,3)）。
  const zeroAdj = [];
  for (let r = 0; r < f.h; r++) for (let c = 0; c < f.w; c++) {
    if (bs[r * f.w + c]) continue;
    const t = NBR.some(([dr, dc]) => {
      const nr = r + dr, nc = c + dc;
      return nr >= 0 && nc >= 0 && nr < f.h && nc < f.w && bs[nr * f.w + nc];
    });
    if (!t) zeroAdj.push([r, c]);
  }
  const [qr, qc] = zeroAdj[0];
  const rowsB = f.face.map((row, r) => r === qr
    ? row.split(' ').map((t, c) => (c === qc ? '?' : (t === '?' ? '.' : t))).join(' ')
    : row);
  const VB = verify(makeFace(rowsB), bs);
  eq(`§3 变异体 B（\`?\` 放到零邻黑格的 ${qr},${qc}）只报 R5 一条`,
    VB.map((v) => v.code).join(','), 'R5');
  ok(`§3 母图当前用的 ${f.qmark} 不是那种格子（黑邻数 ≥1）`,
    !zeroAdj.some(([r, c]) => r === f.qmark[0] && c === f.qmark[1]),
    `零邻黑格候选=${zeroAdj.map((x) => x.join(',')).join(' ')}`);
  // 变异体 C：把 \`?\` 那一格改成数字，且数字比真实读数少 1 —— 尺必须仍然量得到。
  const rowsC = f.face.map((row, r) => r === f.qmark[0]
    ? row.split(' ').map((t, c) => (c === f.qmark[1] ? '9' : t)).join(' ')
    : row);
  const VC = verify(makeFace(rowsC), bs);
  eq('§3 变异体 C（把 `?` 换成一个错的数字）报 R4', VC.map((v) => v.code).join(','), 'R4');
}

// ---------------------------------------------------------------- §4 位图真实
console.log('\n[§4 盘上的位图：路径存在、真是 PNG、尺寸与声明一致、没有 0 字节]');
const html = read('index.html');
const manifest = JSON.parse(read('manifest.webmanifest'));
const sw = read('sw.js');
/** PNG magic + IHDR 宽高（不靠 `file` 命令，也不信文件名）。 */
function pngInfo(rel) {
  const buf = readBuf(rel);
  const magic = buf.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  if (!magic) return { magic, bytes: buf.length, w: 0, h: 0 };
  return { magic, bytes: buf.length, w: buf.readUInt32BE(16), h: buf.readUInt32BE(20),
    bitDepth: buf[24], colorType: buf[25] };
}
const referenced = new Set();
// html 里的引用要按"路径片段"扫：og:image / twitter:image 的 content 是一条完整 URL，
// 只认 src/href 会把社交卡读成死图。
for (const m of html.matchAll(/(?:icons|assets)\/[A-Za-z0-9._/-]+\.png/g)) referenced.add(m[0]);
for (const m of sw.matchAll(/'\.\/([^']+\.png)'/g)) referenced.add(m[1]);
for (const m of read('css/style.css').matchAll(/url\('\.\.\/([^']+)'\)/g)) referenced.add(m[1]);
for (const i of manifest.icons) referenced.add(i.src);
ok(`§4 四处引用（html/css/manifest/sw）合起来的 PNG 路径数`, referenced.size >= 12, `size=${referenced.size}`);
let missing = 0, fake = 0, empty = 0;
for (const p of referenced) {
  let st = null;
  try { st = statSync(path.join(REPO, p)); } catch { missing++; console.log(`      缺文件 ${p}`); continue; }
  if (st.size === 0) { empty++; continue; }
  const info = pngInfo(p);
  if (!info.magic) { fake++; console.log(`      不是 PNG ${p}`); }
}
eq('§4 被引用的路径在盘上全部存在', missing, 0);
eq('§4 没有 0 字节占位', empty, 0);
eq('§4 没有拿 SVG/别的字节冒充 .png', fake, 0);
for (const i of manifest.icons) {
  const [w, h] = i.sizes.split('x').map(Number);
  const info = pngInfo(i.src);
  eq(`§4 manifest 声明 ${i.sizes} ⇒ ${i.src} 的 IHDR 真是这个数`, `${info.w}x${info.h}`, `${w}x${h}`);
}
{
  const at = pngInfo('icons/apple-touch-icon.png');
  ok('§4 apple-touch-icon ≥180px 真 PNG', at.magic && at.w >= 180 && at.h >= 180, `${at.w}x${at.h}`);
  const og = pngInfo('icons/og-image.png');
  eq('§4 社交卡是 1200×630（OpenGraph 的口径）', `${og.w}x${og.h}`, '1200x630');
  ok('§4 社交卡在 html 的 og:image / twitter:image 里被引用',
    /og:image/.test(html) && /twitter:image/.test(html) && html.includes('og-image.png'));
  const fav = [...html.matchAll(/<link rel="icon"[^>]+href="([^"]+)"/g)].map((m) => m[1]);
  ok('§4 favicon 有 link 且指向真 PNG', fav.length >= 1 && fav.every((p) => pngInfo(p).magic), fav.join(' '));
  const maskable = manifest.icons.filter((i) => i.purpose === 'maskable');
  eq('§4 maskable 至少一张且是 512', maskable.length >= 1 && maskable.every((i) => i.sizes === '512x512'), true);
  eq('§4 每张 512 maskable 在盘上确实是 512×512',
    maskable.every((i) => { const n = pngInfo(i.src); return n.w === 512 && n.h === 512; }), true);
}

// ---------------------------------------------------------------- §5 资产被消费
console.log('\n[§5 位图不是躺在盘上：页面与 CSS 真的在吃它们]');
{
  const css = read('css/style.css');
  const fx = read('js/ui/fx.js');
  const varUse = (name) => {
    const def = new RegExp(`--${name}:\\s*url\\('([^']+)'\\)`).exec(css);
    if (!def) return { def: null, uses: 0, file: null };
    const uses = (css.match(new RegExp(`var\\(--${name}\\)`, 'g')) || []).length;
    return { def: def[1], uses, file: def[1].replace('../', '') };
  };
  const paper = varUse('paper-img');
  const ink = varUse('ink-img');
  ok('§5 和纸底纹：CSS 变量定义 + 被 body 消费', !!paper.def && paper.uses >= 1 && /body\s*\{[^}]*var\(--paper-img\)/s.test(css),
    `${paper.def || '未定义'} 用到 ${paper.uses} 处`);
  ok('§5 墨面：CSS 变量定义 + 被 .cell.blk 消费', !!ink.def && ink.uses >= 1 && /\.cell\.blk\s*\{[^}]*var\(--ink-img\)/s.test(css),
    `${ink.def || '未定义'} 用到 ${ink.uses} 处`);
  for (const rel of [paper.file, ink.file].filter(Boolean)) ok(`§5 CSS 指的那张在盘上 ${rel}`, !!pngInfo(rel).magic);
  const sprite = /spriteUrl\s*=\s*'([^']+\.png)'/.exec(fx);
  ok('§5 粒子贴图由 fx.js 的默认参数引到（不是写死在别处的第二份）', !!sprite && !!pngInfo(sprite[1]).magic,
    sprite ? sprite[1] : '未找到 spriteUrl');
  const title = /<img id="title-face"[^>]+src="([^"]+)"/.exec(html);
  ok('§5 标题静图在 index.html 里真被 <img> 引到', !!title && !!pngInfo(title[1]).magic, title ? title[1] : '未找到');
  const swTex = [...sw.matchAll(/'\.\/(assets\/[^']+\.png)'/g)].map((m) => m[1]);
  const referencedAssets = [...referenced].filter((p) => p.startsWith('assets/'));
  eq('§5 游戏内位图全部进了 SW 的 SHELL（离线也要有图）',
    referencedAssets.filter((p) => swTex.includes(p)).length, referencedAssets.length);
  const walk = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? walk(p) : (p.endsWith('.png') ? [path.relative(REPO, p).split(path.sep).join('/')] : []);
  });
  const onDiskAll = [...walk(path.join(REPO, 'assets')), ...walk(path.join(REPO, 'icons'))]
    .filter((p) => !p.startsWith('assets/gen/'));
  // 唯一豁免：1024 是商店上传尺寸，页面与 manifest 都不引它（引了就是让首屏多下载一张 200KB 的图）。
  const EXEMPT = ['icons/icon-1024.png'];
  const unreferenced = onDiskAll.filter((p) => !referenced.has(p) && !EXEMPT.includes(p));
  eq(`§4/§5 盘上 ${onDiskAll.length} 张位图（除 ${EXEMPT.length} 张商店尺寸）全部被引用`,
    unreferenced.length, 0);
}

console.log(`\nMOTIF-TEST ${checks} checks / ${fails} failed`);
process.exit(fails ? 1 : 0);
