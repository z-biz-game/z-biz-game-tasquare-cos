// Service worker · たすくえあ Tasquare
//
// 口径：**同源子资源一律"网络优先、失败退缓存"**。
// 为什么不 cache-first：本仓无构建、文件名不带内容哈希（js/ui/app.js 就叫这个名字），
// 一旦 cache-first，改版后用户拿到的是"新 HTML + 旧 JS"的鬼状态 —— 而 JS 与 HTML 在本仓
// 不是可以分开演进的两件事（页面一句判定都不写，判定全在 js/ 里）。手工版本号只用来
// 在**确实换了发货批次**时把旧 cache 整体清掉，不承担"钉住资源"的职责。
//
// 改动了 SHELL 或本文件的策略 ⇒ 必须把 VERSION 往前挪一格，否则 activate 那一步不会重跑。

const VERSION = 'tasquare-v1';

// 相对 sw.js 解析 ⇒ Pages 的 /<repo>/ 前缀形态与仓库=文档根的形态同一条代码都成立。
const SHELL = [
  './',
  './index.html',
  './css/style.css',
  './manifest.webmanifest',
  './icons/favicon-32.png',
  './icons/apple-touch-icon.png',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './assets/textures/paper-grain.png',
  './assets/textures/ink-block.png',
  './assets/textures/title-face.png',
  './assets/sprites/spark.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(VERSION)
      .then((c) => c.addAll(SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;      // 跨源一律不接管（本仓零外部依赖）
  e.respondWith(networkFirst(req));
});

/** 网络优先；离线或网络报错才退缓存。导航请求在两头都落空时兜回 shell，装机后能离线开页。 */
async function networkFirst(req) {
  const cache = await caches.open(VERSION);
  try {
    const res = await fetch(req);
    if (res && res.ok && req.mode !== 'navigate') cache.put(req, res.clone());
    return res;
  } catch (err) {
    const hit = await cache.match(req);
    if (hit) return hit;
    if (req.mode === 'navigate') {
      const shell = await cache.match('./index.html');
      if (shell) return shell;
    }
    throw err;
  }
}
