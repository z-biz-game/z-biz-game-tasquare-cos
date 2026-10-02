// 画布特效层 · 只画不判（判定与局面状态一律不在这里出现）
//
// 存在的理由：#fx 是一张盖在盘上的 canvas，画 motion.js 交回的涟漪与墨点。
// 两条坐标口径必须写在这里而不是散进 app.js：
//   ① **CSS 缩放换算**：canvas 的位图尺寸是 CSS 尺寸 × devicePixelRatio，
//      指针给的是视口坐标（clientX/clientY）。少减一次 rect.left、或少除一次缩放，
//      手机上就是"点 A 画到 B"——这类错在桌面上看不出来，因为 dpr=1 且窗口没缩放。
//   ② 画布**不吃指针**（pointer-events:none 由 CSS 给），所有命中都从格子的几何算，
//      所以"藏起来的盘还在吃点击"那种事不可能经由这一层发生。

export function makeFx(canvas, { spriteUrl = 'assets/sprites/spark.png' } = {}) {
  const ctx = canvas.getContext ? canvas.getContext('2d') : null;
  const geo = { w: 0, h: 0, dpr: 1, cell: 0, cols: 1, rows: 1, left: 0, top: 0, ready: false };
  let sprite = null;
  let spriteFailed = false;

  if (spriteUrl && typeof Image !== 'undefined') {
    const im = new Image();
    im.onload = () => { sprite = im; };
    im.onerror = () => { spriteFailed = true; };
    im.src = spriteUrl;
  }

  /** 重新量一次：滚动、转屏、换档（格子数变了）都要走这里，位图尺寸不跟着改就是糊的。 */
  function layout(boardEl) {
    if (!ctx || !boardEl) return geo;
    const r = boardEl.getBoundingClientRect();
    const dpr = Math.max(1, Math.min(4, (window.devicePixelRatio || 1)));
    const cs = getComputedStyle(boardEl);
    const track = parseFloat(cs.getPropertyValue('--cell')) || (r.width / Math.max(1, geo.cols));
    geo.cols = Number(cs.getPropertyValue('--cols')) || geo.cols || 1;
    geo.cell = track;
    geo.rows = Math.max(1, Math.round(r.height / (track || 1)));
    geo.w = r.width; geo.h = r.height;
    geo.left = r.left; geo.top = r.top;
    geo.dpr = dpr;
    canvas.width = Math.max(1, Math.round(r.width * dpr));
    canvas.height = Math.max(1, Math.round(r.height * dpr));
    canvas.style.width = `${r.width}px`;
    canvas.style.height = `${r.height}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);      // 之后一律按 CSS 像素画
    geo.ready = true;
    return { ...geo };
  }

  /** 视口坐标 → 格子下标：先减 rect，再按 CSS 缩放（不是位图缩放）除。 */
  function hitCell(clientX, clientY) {
    if (!geo.ready || !geo.cell) return null;
    const col = Math.floor((clientX - geo.left) / geo.cell);
    const row = Math.floor((clientY - geo.top) / geo.cell);
    if (col < 0 || row < 0 || col >= geo.cols || row >= geo.rows) return null;
    return { i: row * geo.cols + col, row, col };
  }

  /** 一帧：涟漪 = 从格心扩出的圈，墨点 = 贴 spark.png 的小点（贴图没到就用方点兜住）。 */
  function draw(motion, { RIPPLE_LIFE, SPARK_LIFE } = {}) {
    if (!ctx || !geo.ready) return 0;
    ctx.clearRect(0, 0, geo.w, geo.h);
    let drawn = 0;
    const u = geo.cell;
    for (const r of motion.st.ripples) {
      const t = r.age / (RIPPLE_LIFE || 0.55);
      if (t >= 1) continue;
      const cx = (r.col + 0.5) * u, cy = (r.row + 0.5) * u;
      ctx.beginPath();
      ctx.arc(cx, cy, u * (0.28 + 0.55 * t), 0, Math.PI * 2);
      ctx.strokeStyle = (r.kind === 'invalid' ? 'rgba(180,35,42,' : 'rgba(20,19,15,') + `${1 - t})`;
      ctx.lineWidth = Math.max(1, u * 0.05 * (1 - t));
      ctx.globalAlpha = 1 - t;
      ctx.stroke();
      drawn++;
    }
    ctx.globalAlpha = 1;
    for (const p of motion.st.sparks) {
      const t = p.age / (SPARK_LIFE || 0.9);
      if (t >= 1) continue;
      const x = p.x * u, y = p.y * u;
      const s = Math.max(2, p.r * 2 * u);
      ctx.globalAlpha = Math.max(0, 1 - t);
      if (sprite) ctx.drawImage(sprite, x - s / 2, y - s / 2, s, s);
      else { ctx.fillStyle = 'rgba(20,19,15,1)'; ctx.fillRect(x - s / 4, y - s / 4, s / 2, s / 2); }
      drawn++;
    }
    ctx.globalAlpha = 1;
    return drawn;
  }

  return { layout, hitCell, draw, geo: () => ({ ...geo }), sprite: () => ({ ok: !!sprite, failed: spriteFailed }) };
}
