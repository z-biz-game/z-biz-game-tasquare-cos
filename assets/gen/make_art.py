#!/usr/bin/env python3
"""本仓的视觉母题「和纸 · 墨方块 · 圈内数字」——所有位图由这个脚本现画，仓里不留手写占位图。

为什么母题是这三样：玩法就是"黑格只能拼成实心正方形区""区与区不许共边""圈里的数字是邻接黑格数"。
图标与社交卡因此直接画一张**合法题面**（黑区 + 现算的线索数字），而不是画一个抽象符号 ——
任何人对着图标就能把三条规则念出来，这是本题材唯一说得通的母题。

母题分两层：
  · full（≥180px）：4×4 题面，两个互不共边的黑区（2×2 与 1×1）、外粗内细的 nikoli 边框、
    线索数字画在真正的圆里，另外留一个不带圈的 `?`（源文本就不带圈）。
  · mark（<180px：icon 16/32/48/96，页面 `<link rel="icon">` 就指这三张里的 16/32/48）：同一个
    构图的减笔版 —— 2×2 黑块 + 一根粗边 + 一个圈。16px 上画 4×4 会糊成灰斑，小尺寸宁可少画
    两笔也要保住"方块"这个形状。原先另有一套 favicon_16/32/48：16 与 48 与 icon_16/48 逐字节
    相同（纯副本），32 却是拿详版母图缩的（违反这条 <180 走减笔的口径），三张都已删掉。

线索数字不是编的，也不是"数邻格里有几个黑格"——那是另一款题的口径。本仓出货用的是引擎
`js/engine/rules.js` 的默认读数 `readA='area'`，即条款 **R4「圈内数字＝正交邻接的黑区格数之和」**：
一个格子邻着某个黑区，就加上**那个区的面积**（同一个区只加一次）。所以邻着 2×2 那块的格子
读的是 **4**，同时邻着 2×2 与另一枚 1×1 的格子读的是 **5**。`clues_for()` 按这条现算。
`?` 更不许随手放：条款 **R5「问号格必须至少邻一个黑格」** —— 它只能落在**真的邻着黑区**的格子上
（落在零邻黑格的格子上，等于图标自己违反它想教的那条规则；本仓实测踩过：母图那个 `?`
原先放在 (3,3)，而 (3,3) 的四邻没有一个黑格，裁判 `verify()` 直接报 R5）。

母题的两张题面（4×4 与社交卡上那张 8×8）连同画上去的 token 一起导出到
`assets/gen/motif.json`，由 `tools/motif-test.mjs` 拿**真引擎**（`makeFace` + `verify` +
`countSolutions`）复验一遍：python 这一侧的口径与引擎一旦分叉，那道闸就红。
图标只声称"题面自洽且画出来的黑区是裁判认得的解之一"，**不**声称解唯一（实测 count≥2）。

配色取自 css/style.css 的 :root（--paper/--ink/--accent/--bad/--won），不另起一套。

确定性：随机只用于纸质颗粒与墨斑，种子写死（PAPER_SEED / INK_SEED）；
脚本末尾把母图重跑一次比像素哈希，两个哈希不同就是随机没钉住（当场非 0 退出）。

    python3 assets/gen/make_art.py            # 全量重画（末尾自证母图哈希同源）

依赖：Pillow（主编机自带）。生成物一律落盘提交，页面不在运行时画图。
"""
import hashlib
import json
import os
import random
import struct
import sys

from PIL import Image, ImageDraw, ImageFilter, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(os.path.dirname(HERE))
ICONS = os.path.join(REPO, 'icons')
TEX = os.path.join(REPO, 'assets', 'textures')
SPR = os.path.join(REPO, 'assets', 'sprites')

# ---- 从 css/style.css 的 :root 实测抽取（改一处就得重跑，色值不第二手抄）
def css_palette():
    css = open(os.path.join(REPO, 'css', 'style.css'), encoding='utf-8').read()
    import re
    want = {'--paper': '#f6f4ee', '--ink': '#14130f', '--accent': '#1d63c9',
            '--bad': '#b4232a', '--won': '#1c7a44'}
    out = {}
    for k, fallback in want.items():
        m = re.search(re.escape(k) + r'\s*:\s*#([0-9a-fA-F]{6})', css)
        out[k] = '#' + (m.group(1) if m else fallback[1:])
    return out


def rgb(h):
    h = h.lstrip('#')
    return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))


PAPER_SEED = 20260930   # 纸质颗粒
INK_SEED = 731          # 墨面斑
MASTER = 1024
SIZES_ICON = [16, 32, 48, 96, 192, 512, 1024]   # 只画有人引的尺寸：64 与 180 曾各留一张死图/一张与 apple-touch-icon 同字节的副本
MARK_BELOW = 180        # <180px 走减笔母题

# 4×4 母题题面：黑区 = 左上 2×2 + (2,2) 的 1×1，两块不共边，白格全连通。
FACE_H, FACE_W = 4, 4
BLACK_CELLS = {(0, 0), (0, 1), (1, 0), (1, 1), (2, 2)}
# `?` 落在 (0,2)：它的四邻里只有 (0,1) 是黑格 ⇒ 邻着 2×2 那一块，R5 成立（原先写死在 (3,3)，
# 而 (3,3) 零邻黑格 ⇒ 图标自己违反 R5，裁判 verify() 报 R5 question-without-adjacent-black）。
MASTER_QMARK = (0, 2)
# 社交卡上那张 8×8：三块互不共边的正方形区（2×2 一块、另一个 2×2 一块、3×3 一块）。
OG_H = OG_W = 8
OG_BLACK_CELLS = {(0, 0), (0, 1), (1, 0), (1, 1), (5, 1), (5, 2), (6, 1), (6, 2),
                  (2, 5), (2, 6), (2, 7), (3, 5), (3, 6), (3, 7), (4, 5), (4, 6), (4, 7)}
# (5,0) 的四邻只有 (5,1) 是黑格 ⇒ 邻着左下那块 2×2，R5 成立（原先写死在 (6,6)，零邻黑格）。
OG_QMARK = (5, 0)
NBR = ((-1, 0), (1, 0), (0, -1), (0, 1))


def components(black):
    """正交连通的墨区，每块带回外接框与面积 —— 与引擎 rules.js::components 同一语义。"""
    seen, comps = set(), []
    for cell in sorted(black):
        if cell in seen:
            continue
        stack, comp = [cell], []
        seen.add(cell)
        while stack:
            x = stack.pop()
            comp.append(x)
            for dr, dc in NBR:
                q = (x[0] + dr, x[1] + dc)
                if q in black and q not in seen:
                    seen.add(q)
                    stack.append(q)
        comps.append(sorted(comp))
    return comps


def clues_for(black, h=None, w=None):
    """R4 现算：白格的读数 = 正交邻到的**每一块黑区的面积之和**（同一块只加一次）；0 就不印。"""
    hh = h or FACE_H
    ww = w or FACE_W
    owner, areas = {}, {}
    for k, cp in enumerate(components(black)):
        areas[k] = len(cp)
        for cell in cp:
            owner[cell] = k
    out = {}
    for r in range(hh):
        for c in range(ww):
            if (r, c) in black:
                continue
            touched = {owner[(r + dr, c + dc)] for dr, dc in NBR if (r + dr, c + dc) in owner}
            n = sum(areas[k] for k in touched)
            if n:
                out[(r, c)] = n
    return out


def qmark_touches(black, cell):
    """R5 自检：这个格子能不能放 `?` —— 必须不是黑格，且四邻至少触到一块黑区。"""
    if cell in black:
        return False
    return any((cell[0] + dr, cell[1] + dc) in black for dr, dc in NBR)


def face_tokens(black, clues, qmark, h=None, w=None):
    """画上去的那串 token 只从这里出：图与 motif.json 因此不可能各说一套。"""
    hh = h or FACE_H
    ww = w or FACE_W
    rows = []
    for r in range(hh):
        row = []
        for c in range(ww):
            k = (r, c)
            if k in black:
                row.append('.')
            elif qmark and k == qmark:
                row.append('?')
            elif k in clues:
                row.append(str(clues[k]))
            else:
                row.append('.')
        rows.append(' '.join(row))
    return rows


def legal(black):
    """自证画出来的是合法盘：黑区全是实心正方形、区与区不共边、白格连通。"""
    # 1) 黑格并成的每一块都是正方形
    seen, blocks = set(), []
    for cell in black:
        if cell in seen:
            continue
        stack, comp = [cell], []
        while stack:
            x = stack.pop()
            if x in seen or x not in black:
                continue
            seen.add(x)
            comp.append(x)
            stack.extend((x[0] + dr, x[1] + dc) for dr, dc in NBR)
        rs = [p[0] for p in comp]
        cs = [p[1] for p in comp]
        h, w = max(rs) - min(rs) + 1, max(cs) - min(cs) + 1
        if h != w or len(comp) != h * w:
            return False, f'黑区 {comp} 不是实心正方形（{h}×{w}，{len(comp)} 格）'
        blocks.append(comp)
    # 2) 两块之间不许共边
    for i, a in enumerate(blocks):
        for b in blocks[i + 1:]:
            if any((p[0] + dr, p[1] + dc) in b for p in a for dr, dc in NBR):
                return False, '两个黑区共边'
    # 3) 白格连通
    whites = {(r, c) for r in range(FACE_H) for c in range(FACE_W)} - black
    rest, stack = set(whites), [next(iter(whites))]
    while stack:
        x = stack.pop()
        if x not in rest:
            continue
        rest.discard(x)
        stack.extend((x[0] + dr, x[1] + dc) for dr, dc in NBR if (x[0] + dr, x[1] + dc) in rest)
    if rest:
        return False, f'白格不连通，剩下 {sorted(rest)}'
    return True, '合法：正方形区 · 不共边 · 白格连通'


# ---------------------------------------------------------------- 纸质与墨面
def paper_tile(size, base, seed, alpha_max=26):
    """可无缝平铺的和纸颗粒：低频斑 + 纤维丝，边缘 wrap 保证 tile 不露缝。"""
    rnd = random.Random(seed)
    img = Image.new('RGBA', (size, size), base + (0,))
    d = ImageDraw.Draw(img)
    step = max(1, size // 64)
    for y in range(0, size, step):
        for x in range(0, size, step):
            v = rnd.random()
            a = int(alpha_max * (v - 0.5) + alpha_max * 0.5)
            col = (0, 0, 0, a // 2) if v < 0.5 else (255, 255, 255, a)
            d.rectangle([x, y, x + step, y + step], fill=col)
    # 纤维：横向为主，少量纵向，画两遍并 wrap（跨界的那条补画一次）
    for _ in range(size // 3):
        y = rnd.randrange(size)
        x0 = rnd.randrange(size)
        ln = int(size * (0.05 + rnd.random() * 0.22))
        a = int(10 + rnd.random() * 22)
        for dx in (0, -size, size):
            d.line([x0 + dx, y, x0 + dx + ln, y + rnd.randint(-1, 1)],
                   fill=(120, 112, 96, a), width=1)
        if rnd.random() < 0.22:
            x = rnd.randrange(size)
            y0 = rnd.randrange(size)
            ln = int(size * (0.04 + rnd.random() * 0.16))
            for dy in (0, -size, size):
                d.line([x, y0 + dy, x + rnd.randint(-1, 1), y0 + dy + ln],
                       fill=(120, 112, 96, a), width=1)
    return img


def paper_rgb(w, h, base, seed, alpha_max=18):
    """纸纹合成到实色底上，交回 RGB（直接 convert('RGB') 会把透明区当黑，整张卡变碎纸）。"""
    tile = paper_tile(max(w, h), base, seed, alpha_max)
    out = Image.new('RGBA', (w, h), base + (255,))
    out = Image.alpha_composite(out, tile.crop((0, 0, w, h)))
    return out.convert('RGB')


def ink_plate(size, base, seed):
    """墨面：不是纯黑，是带细斑的墨。给黑区与 .cell.blk 用。"""
    rnd = random.Random(seed)
    img = Image.new('RGB', (size, size), base)
    d = ImageDraw.Draw(img)
    for _ in range(size * size // 130):
        x, y = rnd.randrange(size), rnd.randrange(size)
        r = rnd.choice([1, 2, 2, 3, 4])
        v = rnd.randint(-16, 15)
        c = tuple(max(0, min(255, ch + v)) for ch in base)
        d.ellipse([x - r, y - r, x + r, y + r], fill=c)
    return img.filter(ImageFilter.GaussianBlur(max(0.6, size / 150)))


# ---------------------------------------------------------------- 母题绘制
def cjk_font(px, bold=False):
    """取一个真的能画中文/假名的字体；找不到就退到 PIL 默认（只画数字仍成立）。"""
    cands = (['/System/Library/Fonts/STHeiti Medium.ttc',
              '/System/Library/Fonts/Hiragino Sans GB.ttc'] if bold else
             ['/System/Library/Fonts/Hiragino Sans GB.ttc',
              '/System/Library/Fonts/STHeiti Medium.ttc'])
    for p in cands:
        if os.path.exists(p):
            try:
                return ImageFont.truetype(p, px, index=0)
            except Exception:
                continue
    return ImageFont.load_default()


def draw_face(img, origin, side, palette, black, clues, qmark, ring_label=True, h=None, w=None):
    """画一张题面：外粗内细边框 + 墨方块 + 圈内数字 + 不带圈的 ?"""
    d = ImageDraw.Draw(img)
    ox, oy = origin
    fh = h or FACE_H
    fw = w or FACE_W
    u = side / fw
    paper, ink, accent = rgb(palette['--paper']), rgb(palette['--ink']), rgb(palette['--accent'])
    # 外粗内细：整张盘的上下走粗边，每格走左右细边（沿用 css 的边框语言）
    thick = max(3, side * 0.028)
    thin = max(1, side * 0.009)
    # 黑区（整张盘共用一张墨面按格裁剪，4×4 上的墨斑因此连续而不是重复）
    inkblk = ink_plate(int(side), ink, INK_SEED)
    for r, c in black:
        x0, y0 = ox + c * u, oy + r * u
        crop = inkblk.crop((int(c * u), int(r * u), int((c + 1) * u), int((r + 1) * u)))
        img.paste(crop.resize((max(1, int(u)), max(1, int(u))), Image.LANCZOS), (int(x0), int(y0)))
    # 细内边
    for k in range(1, fw):
        d.line([ox + k * u, oy, ox + k * u, oy + side], fill=ink, width=int(thin))
    for k in range(1, fh):
        d.line([ox, oy + k * u, ox + side, oy + k * u], fill=ink, width=int(thin))
    # 粗外边
    d.rectangle([ox, oy, ox + side, oy + side], outline=ink, width=int(thick))
    # 圈内数字
    fnt = cjk_font(int(u * 0.40))
    for (r, c), n in clues.items():
        cx, cy = ox + (c + 0.5) * u, oy + (r + 0.5) * u
        rad = u * 0.31
        d.ellipse([cx - rad, cy - rad, cx + rad, cy + rad], fill=paper, outline=ink,
                  width=max(2, int(u * 0.045)))
        t = str(n)
        bb = d.textbbox((0, 0), t, font=fnt)
        d.text((cx - (bb[2] - bb[0]) / 2 - bb[0], cy - (bb[3] - bb[1]) / 2 - bb[1]),
               t, font=fnt, fill=ink)
    if qmark is not None:
        r, c = qmark
        cx, cy = ox + (c + 0.5) * u, oy + (r + 0.5) * u
        f2 = cjk_font(int(u * 0.52))
        bb = d.textbbox((0, 0), '?', font=f2)
        d.text((cx - (bb[2] - bb[0]) / 2 - bb[0], cy - (bb[3] - bb[1]) / 2 - bb[1]),
               '?', font=f2, fill=rgb(palette['--accent']))
    return img


def ink_tile(plate, size):
    """墨面 2×2 平铺再缩到 size×size：得到一张能无缝铺的墨底（贴图不该被拉糊）。"""
    out = Image.new('RGB', (plate.width * 2, plate.height * 2))
    for i in range(2):
        for j in range(2):
            out.paste(plate, (i * plate.width, j * plate.height))
    return out.resize((size, size), Image.LANCZOS)


def face_spec(name, black, qmark, h, w):
    """一张题面的唯一推导处：画到图上的、写进 motif.json 的、node 闸复验的都是这一份。"""
    ok, why = legal(set(black))
    if not ok:
        raise SystemExit(f'{name} 的图样自己就不合法：{why}')
    if qmark is not None and not qmark_touches(black, qmark):
        raise SystemExit(f'{name} 的 `?` 落在 {qmark}：四邻没有黑格，违反 R5')
    clues = clues_for(set(black), h, w)
    printed = {k: v for k, v in clues.items() if k != qmark}
    return {
        'name': name, 'h': h, 'w': w,
        'blacks': [[r, c] for r, c in sorted(black)],
        'qmark': list(qmark) if qmark else None,
        'clues': {f'{r},{c}': v for (r, c), v in sorted(printed.items())},
        'face': face_tokens(set(black), printed, qmark, h, w),
    }


def build_motifs():
    return [face_spec('master-4x4', BLACK_CELLS, MASTER_QMARK, FACE_H, FACE_W),
            face_spec('og-8x8', OG_BLACK_CELLS, OG_QMARK, OG_H, OG_W)]


def draw_spec(img, origin, side, palette, spec):
    return draw_face(img, origin, side, palette, [tuple(b) for b in spec['blacks']],
                     {tuple(int(x) for x in k.split(',')): v for k, v in spec['clues'].items()},
                     tuple(spec['qmark']) if spec['qmark'] else None,
                     h=spec['h'], w=spec['w'])


def master_full(palette, spec):
    side = MASTER
    img = Image.new('RGBA', (side, side), rgb(palette['--paper']) + (255,))
    grain = paper_tile(side, rgb(palette['--paper']), PAPER_SEED, alpha_max=20)
    img = Image.alpha_composite(img, grain)
    pad = side * 0.12
    draw_spec(img, (pad, pad), side - 2 * pad, palette, spec)
    return img


def master_mark(palette):
    """减笔母题：一格 2×2 墨方块 + 一个圈内数字 + 一根粗边。小尺寸靠它保住形状。"""
    side = MASTER
    img = Image.new('RGBA', (side, side), rgb(palette['--paper']) + (255,))
    img = Image.alpha_composite(img, paper_tile(side, rgb(palette['--paper']), PAPER_SEED, 18))
    d = ImageDraw.Draw(img)
    ink = rgb(palette['--ink'])
    plate = ink_plate(side // 2, ink, INK_SEED)
    bx, by, bw = side * 0.14, side * 0.14, side * 0.44
    img.paste(plate.resize((int(bw), int(bw)), Image.LANCZOS), (int(bx), int(by)))
    # 圈内数字 = 图上那块墨区的面积：面积口径下，任何邻着它的格子读的都是这个数（2×2 ⇒ 4）。
    # 早先这里取的是 max(clues.values())，改成面积口径后那会是 5 —— 而 5 需要**两块**区才读得出来，
    # 减笔母题上只画了一块，等于在小图标上写一个图上无法自证的数字。
    n = max(len(cp) for cp in components(set(BLACK_CELLS)))
    cx, cy, rad = side * 0.665, side * 0.665, side * 0.245
    d.ellipse([cx - rad, cy - rad, cx + rad, cy + rad], fill=rgb(palette['--paper']),
              outline=ink, width=int(side * 0.035))
    fnt = cjk_font(int(side * 0.30))
    label = str(n)
    bb = d.textbbox((0, 0), label, font=fnt)
    d.text((cx - (bb[2] - bb[0]) / 2 - bb[0], cy - (bb[3] - bb[1]) / 2 - bb[1]),
           label, font=fnt, fill=ink)
    d.rectangle([side * 0.06, side * 0.06, side * 0.94, side * 0.94], outline=ink,
                width=int(side * 0.045))
    return img


def rounded(img, radius_ratio=0.185):
    """macOS/iOS 风格的连续圆角裁切（圆角比例对齐 icon-1024 的常规做法）。"""
    s = img.width
    r = int(s * radius_ratio)
    mask = Image.new('L', (s, s), 0)
    d = ImageDraw.Draw(mask)
    d.rounded_rectangle([0, 0, s, s], radius=r, fill=255)
    # 超采样一次再缩回来，圆角不呈阶梯
    big = img.resize((s * 2, s * 2), Image.LANCZOS)
    m2 = mask.resize((s * 2, s * 2), Image.LANCZOS)
    out = big.copy()
    out.putalpha(m2)
    return out.resize((s, s), Image.LANCZOS)


def maskable(full, palette):
    """maskable：内容缩进中心 62%（Chrome 的安全区），底铺满实色。"""
    s = full.width
    bg = Image.new('RGBA', (s, s), rgb(palette['--paper']) + (255,))
    bg = Image.alpha_composite(bg, paper_tile(s, rgb(palette['--paper']), PAPER_SEED, 14))
    inner = full.resize((int(s * 0.62), int(s * 0.62)), Image.LANCZOS)
    bg.alpha_composite(inner, (int((s - inner.width) / 2), int((s - inner.height) / 2)))
    return bg


def og_card(palette, spec):
    """1200×630 社交卡：左边真题面，右边标题 + 一句玩法 + 部署地址。"""
    W, H = 1200, 630
    img = paper_rgb(W, H, rgb(palette['--paper']), PAPER_SEED, 16)
    d = ImageDraw.Draw(img)
    ink = rgb(palette['--ink'])
    quiet = tuple(int(0.55 * i + 0.45 * 255) for i in ink)
    # 左：8×8 的真题面（三块互不共边的正方形区：2×2 两块、3×3 一块），题面由 build_motifs 现推
    side = 470
    ox, oy = 56, (H - side) / 2
    face = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    draw_spec(face, (ox, oy), side, palette, spec)
    img.paste(face, (0, 0), face)
    d = ImageDraw.Draw(img)
    tx = 600
    d.text((tx, 96), 'たすくえあ', font=cjk_font(84), fill=ink)
    d.text((tx, 208), 'Tasquare', font=cjk_font(52, True), fill=quiet)
    for i, line in enumerate(('黑格只能拼成实心正方形区', '区与区不许共边 · 白格全连通',
                              '圈里数字 = 邻接黑格数之和')):
        d.text((tx, 300 + i * 46), line, font=cjk_font(30), fill=ink)
    d.line([tx, 452, W - 56, 452], fill=quiet, width=2)

    def draw_line(line, y, px, fill):
        """按右栏可用宽度自动降字号：写死字号 = 换一条长文案就被裁掉半句，而图上没人能发现。"""
        while px > 16 and d.textbbox((0, 0), line, font=cjk_font(px))[2] > (W - 56) - tx:
            px -= 1
        d.text((tx, y), line, font=cjk_font(px), fill=fill)
        return px

    p1 = draw_line('每一局都由穷举裁判证明解唯一，由零猜测铅笔证明推得完。', 470, 24, quiet)
    p2 = draw_line('z-biz-game.github.io/z-biz-game-tasquare-cos', 516, 24, rgb(palette['--accent']))
    print(f'  社交卡右栏自动降字号：正文 {p1}px · 网址 {p2}px（可用宽 {(W - 56) - tx}px）')
    return img


# ---------------------------------------------------------------- 盘上产物
def write(img, rel, note=''):
    path = os.path.join(REPO, rel)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    if img.mode == 'P':
        img = img.convert('RGBA')
    img.save(path, 'PNG', optimize=True)
    raw = open(path, 'rb').read()
    w, h = struct.unpack('>II', raw[16:24])
    kind = 'PNG' if raw[:8] == b'\x89PNG\r\n\x1a\n' else '??'
    print(f'  {rel:38s} {w}x{h} {kind} {len(raw):7d}B {note}')
    return path


def main():
    palette = css_palette()
    print('配色（从 css/style.css :root 实测）：'
          + ' · '.join(f'{k}={v}' for k, v in palette.items()))
    motifs = build_motifs()
    spec_path = os.path.join(HERE, 'motif.json')
    spec_text = json.dumps({'readA': 'area', 'faces': motifs}, ensure_ascii=False, indent=2) + '\n'
    with open(spec_path, 'w', encoding='utf-8') as fh:
        fh.write(spec_text)
    print(f'\n题面自证（面积口径 R4 + R5，导出 {os.path.relpath(spec_path, REPO)} 给 node 闸复验）：')
    for m in motifs:
        print(f'  {m["name"]}: 黑区 {len(m["blacks"])} 格 / {len(components(set(tuple(b) for b in m["blacks"])))} 块 · '
              f'印 {len(m["clues"])} 条数字 + `?`@{tuple(m["qmark"])}')
        for row in m['face']:
            print(f'     {row}')
        print(f'     读数 {m["clues"]}')

    full = master_full(palette, motifs[0])
    mark = master_mark(palette)
    print('\n[icons]')
    for s in SIZES_ICON:
        src = full if s >= MARK_BELOW else mark
        write(rounded(src.resize((s, s), Image.LANCZOS)), f'icons/icon-{s}.png')
    write(rounded(full.resize((180, 180), Image.LANCZOS)), 'icons/apple-touch-icon.png', '180=Apple 口径')
    write(maskable(rounded(full, 0.0), palette).resize((512, 512), Image.LANCZOS),
          'icons/icon-maskable-512.png', 'maskable 安全区 62%')
    write(og_card(palette, motifs[1]), 'icons/og-image.png', '1200x630 社交卡')

    print('\n[游戏内位图]')
    write(paper_tile(256, rgb(palette['--paper']), PAPER_SEED, 22), 'assets/textures/paper-grain.png',
          'body 底纹 · 无缝平铺')
    write(ink_tile(ink_plate(96, rgb(palette['--ink']), INK_SEED), 96).convert('RGBA'),
          'assets/textures/ink-block.png', '.cell.blk 的墨面 · 96px 无缝可铺')
    spark = Image.new('RGBA', (64, 64), (0, 0, 0, 0))
    dd = ImageDraw.Draw(spark)
    for i in range(64, 0, -1):
        a = int(255 * (i / 64) ** 2.4)
        dd.ellipse([32 - i / 2, 32 - i / 2, 32 + i / 2, 32 + i / 2], fill=(20, 19, 15, a))
    write(spark, 'assets/sprites/spark.png', '落子涟漪的粒子贴图')
    write(rounded(full.resize((240, 240), Image.LANCZOS)), 'assets/textures/title-face.png',
          '标题区的静图（reduceMotion 用它替掉动效）')

    print('\n[确定性自证]')
    again = master_full(palette, build_motifs()[0])
    h1 = hashlib.sha256(full.tobytes()).hexdigest()[:16]
    h2 = hashlib.sha256(again.tobytes()).hexdigest()[:16]
    print(f'  母图重跑哈希 {h1} vs {h2} ⇒ {"同图" if h1 == h2 else "不同图（随机没钉住）"}')
    drift = open(spec_path, encoding='utf-8').read() != spec_text
    print(f'  题面导出重跑 {"一致" if not drift else "不一致（几何在两次推导之间漂了）"}')
    if h1 != h2 or drift:
        raise SystemExit(2)


if __name__ == '__main__':
    main()
