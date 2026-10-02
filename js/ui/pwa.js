// 可安装性接线 · 只在 http(s) 下注册 service worker
//
// 三条口径：
//   ① file:// 直接跳过：SW 的注册作用域要一个 origin，`file:` 没有 —— 硬注册的实测结果是
//      一条未捕获的 SecurityError 挂在控制台，页面其余部分照常跑（看起来"没事"，其实是这条腿根本没接）。
//   ② 注册路径按 document.baseURI 解析：Pages 的 /<repo>/ 前缀形态下写死 '/sw.js' 会 404，
//      而 404 的 SW 是**静默**的（register() 的 promise 才 reject，浏览器不弹装机提示）。
//   ③ 注册失败不许把页面带走：这里只记一个状态，HUD 上那颗装机提示按状态出现或不出现。

const status = { supported: 'serviceWorker' in navigator, registered: false, scope: null, error: null };

export function pwaStatus() {
  return { ...status };
}

export function registerServiceWorker() {
  if (!status.supported) return Promise.resolve(status);
  if (location.protocol === 'file:' || !location.protocol.startsWith('http')) {
    status.error = `${location.protocol} 没有 origin，跳过注册（不是失败，是这条通道在此形态下不存在）`;
    return Promise.resolve(status);
  }
  const url = new URL('sw.js', document.baseURI).href;
  return navigator.serviceWorker.register(url, { scope: new URL('./', document.baseURI).href })
    .then((reg) => {
      status.registered = true;
      status.scope = reg.scope;
      return status;
    })
    .catch((err) => {
      status.error = String(err && err.message ? err.message : err);
      return status;                      // 不 rethrow：装不上机不等于玩不了
    });
}

// 被 app.js import；本模块自己不再抢跑，注册时机交给调用方（load 之后）。
